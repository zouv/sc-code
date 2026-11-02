use base64::Engine as _;
use serde::Serialize;
use std::collections::HashMap;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

const MAX_RESPONSE_BYTES: usize = 50 * 1024 * 1024; // 50 MB
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

const ALLOWED_HOSTS: &[&str] = &[
    // ScCode marketplace (Open VSX + Microsoft, via the siden.ai Worker)
    "marketplace.siden.ai",
    // Open VSX
    "open-vsx.org",
    "openvsx.eclipsecontent.org",
    // Microsoft Marketplace
    "marketplace.visualstudio.com",
    "az764295.vo.msecnd.net",
    "vscode-unpkg.net",
    "gallery.vsassets.io",
    "vsmarketplacebadges.dev",
    "vscode.blob.core.windows.net",
    // VS Code asset CDN (VSIX packages + icons)
    "vsassets.io",
    "openvsxorg.blob.core.windows.net",
    // GitHub (readme images, OAuth, API, codespaces, extension assets)
    "github.com",
    "api.github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "codeload.github.com",
    // Updates
    "update.code.visualstudio.com",
];

fn validate_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed: reqwest::Url = url.parse().map_err(|_| "invalid URL".to_string())?;

    match parsed.scheme() {
        "http" | "https" => {}
        s => return Err(format!("blocked scheme: {s}")),
    }

    let host = parsed.host_str().ok_or("missing host")?;

    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        validate_public_ip(ip)?;
    }

    Ok(parsed)
}

/// Only globally routable unicast destinations are allowed. Apply the same
/// policy to literals and every DNS answer, including IPv4-mapped IPv6.
fn validate_public_ip(ip: IpAddr) -> Result<(), String> {
    let public = match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 168 || b == 0 && (c == 0 || c == 2) || b == 88 && c == 99))
                || (a == 198 && (b == 18 || b == 19 || b == 51 && c == 100))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return validate_public_ip(IpAddr::V4(mapped));
            }
            let [a, b, ..] = ip.segments();
            // 2000::/3 global unicast, minus protocol assignments, documentation
            // and 6to4 (which can tunnel traffic to an embedded private IPv4).
            (a & 0xe000) == 0x2000
                && !(a == 0x2001 && (b < 0x0200 || b == 0x0db8)
                    || a == 0x2002
                    || a == 0x3fff && (b & 0xf000) == 0)
        }
    };
    if public {
        Ok(())
    } else {
        Err("requests to non-public addresses are blocked".into())
    }
}

struct SystemDns;
impl reqwest::dns::Resolve for SystemDns {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async move {
            let addresses: Vec<_> = tokio::net::lookup_host((name.as_str(), 0)).await?.collect();
            Ok(Box::new(addresses.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

/// Validate and return the *same* resolved sockets to reqwest, never a second
/// lookup. New connections (including redirects) re-enter this resolver; pooled
/// connections remain pinned to their previously validated public peer.
struct PublicDns {
    source: Arc<dyn reqwest::dns::Resolve>,
}
impl PublicDns {
    fn new() -> Self {
        Self {
            source: Arc::new(SystemDns),
        }
    }
}
impl reqwest::dns::Resolve for PublicDns {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let source = self.source.clone();
        Box::pin(async move {
            let answers = tokio::time::timeout(Duration::from_secs(5), source.resolve(name))
                .await
                .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "DNS lookup timed out"))??;
            let addresses: Vec<SocketAddr> = answers.collect();
            if addresses.is_empty() {
                return Err(
                    io::Error::new(io::ErrorKind::NotFound, "DNS returned no addresses").into(),
                );
            }
            // Reject mixed public/private answers too; filtering them would hide
            // an unsafe resolution and allow alternate-family fallback surprises.
            for address in &addresses {
                validate_public_ip(address.ip())
                    .map_err(|error| io::Error::new(io::ErrorKind::PermissionDenied, error))?;
            }
            Ok(Box::new(addresses.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

/// Checks if a URL's host is allowed to be proxied.
///
/// # Security
///
/// The allowlist comparison is case-insensitive to prevent bypass attacks
/// where an attacker uses mixed-case hostnames (e.g., "OpenVSX.org" vs "openvsx.org").
///
/// Also prevents subdomain takeover attacks by ensuring the host is either:
/// - An exact match for an allowed host
/// - A proper subdomain (e.g., "extension.openvsx.org" matches "openvsx.org")
fn is_host_allowed(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    // SECURITY: Normalize to lowercase for case-insensitive comparison
    // Prevents bypass via case variation (e.g., "OpenVSX.org" vs "openvsx.org")
    let host = host.to_ascii_lowercase();

    for allowed in ALLOWED_HOSTS {
        let allowed = allowed.to_ascii_lowercase();
        if host == allowed {
            return true;
        }
        // Check if host is a subdomain of allowed
        // e.g., "ext.openvsx.org" ends with ".openvsx.org"
        if host.ends_with(&format!(".{allowed}")) {
            return true;
        }
    }
    false
}

/// Process-wide shared HTTP client. One client = one connection pool
/// shared across all proxy requests. This eliminates the per-request
/// TCP + TLS handshake overhead that was causing 8-10 s cold requests.
static PROXY_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static FETCH_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn get_client(allowlist: bool) -> &'static reqwest::Client {
    let cache = if allowlist {
        &PROXY_CLIENT
    } else {
        &FETCH_CLIENT
    };
    cache.get_or_init(|| {
        reqwest::Client::builder()
            // A system/environment proxy could resolve the destination again and
            // bypass PublicDns. These renderer fetch APIs intentionally go direct;
            // Agent/provider transports keep their separate proxy configuration.
            .no_proxy()
            .dns_resolver(Arc::new(PublicDns::new()))
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(Duration::from_secs(5))
            .tcp_keepalive(Some(Duration::from_mins(1)))
            .pool_idle_timeout(Some(Duration::from_secs(90)))
            .pool_max_idle_per_host(8)
            .http2_keep_alive_interval(Some(Duration::from_secs(30)))
            .http2_keep_alive_timeout(Duration::from_secs(10))
            .http2_keep_alive_while_idle(true)
            .http2_adaptive_window(true)
            .gzip(true)
            .brotli(true)
            .redirect(reqwest::redirect::Policy::custom(move |attempt| {
                if attempt.previous().len() >= 5 {
                    return attempt.error("too many redirects");
                }
                match validate_redirect(attempt.url(), allowlist) {
                    Ok(()) => attempt.follow(),
                    Err(error) => attempt.error(error),
                }
            }))
            .build()
            .expect("static HTTP client configuration")
    })
}

fn validate_redirect(url: &reqwest::Url, allowlist: bool) -> Result<(), String> {
    validate_url(url.as_str())?;
    if allowlist && !is_host_allowed(url) {
        return Err("redirect host is not allowed".into());
    }
    Ok(())
}

async fn read_body_limited(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|len| len > MAX_RESPONSE_BYTES as u64)
    {
        return Err("response too large".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("read failed: {e}"))?
    {
        append_body_chunk(&mut bytes, &chunk)?;
    }
    Ok(bytes)
}

fn append_body_chunk(bytes: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    if chunk.len() > MAX_RESPONSE_BYTES.saturating_sub(bytes.len()) {
        return Err("response too large".into());
    }
    bytes.extend_from_slice(chunk);
    Ok(())
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub async fn fetch_url(url: String) -> Result<Vec<u8>, String> {
    let parsed = validate_url(&url)?;
    let client = get_client(false);
    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;
    read_body_limited(response).await
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub async fn fetch_url_text(url: String) -> Result<String, String> {
    let parsed = validate_url(&url)?;
    let client = get_client(false);
    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;
    let bytes = read_body_limited(response).await?;
    String::from_utf8(bytes).map_err(|e| format!("invalid UTF-8: {e}"))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub async fn proxy_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<String, String> {
    let parsed = validate_url(&url)?;
    if !is_host_allowed(&parsed) {
        return Err(format!(
            "proxy requests to '{}' are not allowed",
            parsed.host_str().unwrap_or("unknown")
        ));
    }

    let client = get_client(true);

    let mut req = match method.to_uppercase().as_str() {
        "POST" => client.post(parsed),
        "PUT" => client.put(parsed),
        "DELETE" => client.delete(parsed),
        "PATCH" => client.patch(parsed),
        _ => client.get(parsed),
    };

    for (key, value) in &headers {
        req = req.header(key.as_str(), value.as_str());
    }

    if let Some(b) = body {
        req = req.body(b);
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("proxy request failed: {e}"))?;

    let bytes = read_body_limited(response).await?;
    String::from_utf8(bytes).map_err(|e| format!("invalid UTF-8 in proxy response: {e}"))
}

#[derive(Serialize)]
pub struct ProxyResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body_b64: String,
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub async fn proxy_request_full(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<ProxyResponse, String> {
    let parsed = validate_url(&url)?;
    if !is_host_allowed(&parsed) {
        return Err(format!(
            "proxy requests to '{}' are not allowed",
            parsed.host_str().unwrap_or("unknown")
        ));
    }

    let client = get_client(true);

    let mut req = match method.to_uppercase().as_str() {
        "POST" => client.post(parsed),
        "PUT" => client.put(parsed),
        "DELETE" => client.delete(parsed),
        "PATCH" => client.patch(parsed),
        _ => client.get(parsed),
    };

    for (key, value) in &headers {
        if key.eq_ignore_ascii_case("accept-encoding") {
            continue;
        }
        req = req.header(key.as_str(), value.as_str());
    }

    if let Some(b) = body {
        req = req.body(b);
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("proxy request failed: {e}"))?;

    let status = response.status().as_u16();
    let mut resp_headers: HashMap<String, String> = HashMap::new();
    for (k, v) in response.headers() {
        if let Ok(v_str) = v.to_str() {
            resp_headers.insert(k.to_string(), v_str.to_string());
        }
    }

    let bytes = read_body_limited(response).await?;
    let body_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    Ok(ProxyResponse {
        status,
        headers: resp_headers,
        body_b64,
    })
}

#[cfg(test)]
mod security_tests {
    use super::*;
    #[test]
    fn redirect_destinations_keep_the_original_policy() {
        for target in [
            "http://127.0.0.1/",
            "http://[::1]/",
            "http://[fc00::1]/",
            "http://[fe80::1]/",
            "http://[::ffff:127.0.0.1]/",
        ] {
            assert!(validate_redirect(&target.parse().unwrap(), false).is_err());
        }
        assert!(validate_redirect(&"https://example.com/".parse().unwrap(), true).is_err());
        assert!(validate_redirect(&"https://example.com/".parse().unwrap(), false).is_ok());
        assert!(validate_redirect(&"https://open-vsx.org/".parse().unwrap(), true).is_ok());
    }
    #[test]
    fn special_use_literals_are_rejected_in_both_families() {
        for ip in [
            "0.1.2.3",
            "100.64.0.1",
            "192.0.0.1",
            "192.0.2.1",
            "192.88.99.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "255.255.255.255",
            "64:ff9b::a00:1",
            "2002:a00:1::1",
            "2001::1",
            "2001:db8::1",
            "3fff::1",
            "::ffff:10.0.0.1",
        ] {
            assert!(validate_public_ip(ip.parse().unwrap()).is_err(), "{ip}");
        }
        for ip in [
            "1.1.1.1",
            "8.8.8.8",
            "2606:4700:4700::1111",
            "::ffff:8.8.8.8",
        ] {
            assert!(validate_public_ip(ip.parse().unwrap()).is_ok(), "{ip}");
        }
    }

    struct ScriptedDns {
        answers: std::sync::Mutex<Vec<Vec<SocketAddr>>>,
    }
    impl reqwest::dns::Resolve for ScriptedDns {
        fn resolve(&self, _name: reqwest::dns::Name) -> reqwest::dns::Resolving {
            let answers = self.answers.lock().unwrap().remove(0);
            Box::pin(async move { Ok(Box::new(answers.into_iter()) as reqwest::dns::Addrs) })
        }
    }
    fn scripted(answers: &[&[&str]]) -> PublicDns {
        PublicDns {
            source: Arc::new(ScriptedDns {
                answers: std::sync::Mutex::new(
                    answers
                        .iter()
                        .map(|batch| {
                            batch
                                .iter()
                                .map(|ip| SocketAddr::new(ip.parse().unwrap(), 0))
                                .collect()
                        })
                        .collect(),
                ),
            }),
        }
    }
    #[tokio::test]
    async fn dns_rejects_empty_mixed_and_rebound_answers() {
        use reqwest::dns::Resolve;
        for batch in [
            &[][..],
            &["8.8.8.8", "127.0.0.1"][..],
            &["8.8.8.8", "fc00::1"][..],
        ] {
            assert!(scripted(&[batch])
                .resolve("example.com".parse().unwrap())
                .await
                .is_err());
        }
        let dns = scripted(&[&["8.8.8.8", "2606:4700:4700::1111"], &["127.0.0.1"]]);
        let first = dns.resolve("example.com".parse().unwrap()).await.unwrap();
        assert_eq!(
            first.map(|a| a.ip().to_string()).collect::<Vec<_>>(),
            ["8.8.8.8", "2606:4700:4700::1111"]
        );
        assert!(dns.resolve("example.com".parse().unwrap()).await.is_err());
    }
    #[tokio::test]
    async fn reqwest_cannot_connect_to_a_private_dns_answer() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client = reqwest::Client::builder()
            .no_proxy()
            .dns_resolver(Arc::new(scripted(&[&["127.0.0.1"]])))
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        assert!(client
            .get(format!(
                "http://attacker.example:{}/",
                listener.local_addr().unwrap().port()
            ))
            .send()
            .await
            .is_err());
        assert!(
            tokio::time::timeout(Duration::from_millis(100), listener.accept())
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn system_dns_blocks_localhost() {
        use reqwest::dns::Resolve;
        assert!(PublicDns::new()
            .resolve("localhost".parse().unwrap())
            .await
            .is_err());
        assert!(get_client(false)
            .get("http://localhost/")
            .send()
            .await
            .is_err());
    }

    #[test]
    fn unknown_length_body_is_bounded_before_append() {
        let mut bytes = vec![0; MAX_RESPONSE_BYTES - 1];
        append_body_chunk(&mut bytes, b"x").unwrap();
        assert!(append_body_chunk(&mut bytes, b"y").is_err());
        assert_eq!(bytes.len(), MAX_RESPONSE_BYTES);
    }
}
