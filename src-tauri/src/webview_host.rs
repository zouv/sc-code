//! Serves the extension webview host page from its own loopback origin.
//!
//! Workbench pages run on the app origin with full IPC access. Extension
//! webviews need `allow-scripts allow-same-origin`, which only stays a sandbox
//! when the iframe origin differs from its parent. Tauri treats every custom
//! protocol as a local (trusted) origin, so the host page is served over plain
//! loopback HTTP instead: `http://127.0.0.1:<port>` is a remote origin for the
//! ACL (plugin/core commands are rejected) and supports service workers.
//! App commands are additionally gated by [`crate::ipc_guard`].

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

const INDEX_HTML: &[u8] = include_bytes!("../../public/webview-pre/index.html");
const FAKE_HTML: &[u8] = include_bytes!("../../public/webview-pre/fake.html");
const SERVICE_WORKER_JS: &[u8] = include_bytes!("../../public/webview-pre/service-worker.js");
const MAX_REQUEST_HEAD: usize = 16 * 1024;

pub struct WebviewHost {
    origin: String,
}

impl WebviewHost {
    pub fn origin(&self) -> &str {
        &self.origin
    }
}

/// Binds an ephemeral loopback port and serves the webview host files on a background thread.
pub fn start() -> std::io::Result<WebviewHost> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let origin = format!("http://127.0.0.1:{}", listener.local_addr()?.port());
    std::thread::Builder::new()
        .name("webview-host".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let _ = std::thread::Builder::new()
                    .name("webview-host-conn".into())
                    .spawn(move || serve_connection(stream));
            }
        })?;
    Ok(WebviewHost { origin })
}

fn asset(path: &str) -> Option<(&'static [u8], &'static str)> {
    match path.trim_start_matches('/') {
        "" | "index.html" => Some((INDEX_HTML, "text/html; charset=utf-8")),
        "fake.html" => Some((FAKE_HTML, "text/html; charset=utf-8")),
        "service-worker.js" => Some((SERVICE_WORKER_JS, "text/javascript; charset=utf-8")),
        _ => None,
    }
}

/// Builds the full HTTP/1.1 response for a raw request head.
fn respond(head: &str) -> Vec<u8> {
    let mut parts = head.lines().next().unwrap_or_default().split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    let path = target.split(['?', '#']).next().unwrap_or_default();

    let (status, mime, body): (&str, &str, &[u8]) = match (method, asset(path)) {
        ("GET" | "HEAD", Some((body, mime))) => ("200 OK", mime, body),
        ("GET" | "HEAD", None) => ("404 Not Found", "text/plain", b"Not Found"),
        _ => ("405 Method Not Allowed", "text/plain", b"Method Not Allowed"),
    };
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    if method != "HEAD" {
        response.extend_from_slice(body);
    }
    response
}

fn serve_connection(mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let mut head = Vec::new();
    let mut buf = [0u8; 2048];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => return,
            Ok(n) => head.extend_from_slice(&buf[..n]),
        }
        if head.len() > MAX_REQUEST_HEAD {
            return;
        }
    }
    let _ = stream.write_all(&respond(&String::from_utf8_lossy(&head)));
    let _ = stream.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(head: &str) -> String {
        String::from_utf8_lossy(&respond(head)).lines().next().unwrap().to_string()
    }

    #[test]
    fn serves_only_webview_host_files() {
        for target in ["/", "/index.html", "/fake.html?id=1", "/service-worker.js?v=4&x=1"] {
            assert_eq!(status(&format!("GET {target} HTTP/1.1\r\n\r\n")), "HTTP/1.1 200 OK", "{target}");
        }
        for target in ["/../Cargo.toml", "/webview-pre/index.html", "/main.js", "/C:/Windows/win.ini"] {
            assert_eq!(status(&format!("GET {target} HTTP/1.1\r\n\r\n")), "HTTP/1.1 404 Not Found", "{target}");
        }
        assert_eq!(status("POST / HTTP/1.1\r\n\r\n"), "HTTP/1.1 405 Method Not Allowed");
    }

    #[test]
    fn head_has_no_body_and_worker_is_javascript() {
        let response = String::from_utf8_lossy(&respond("HEAD /service-worker.js HTTP/1.1\r\n\r\n")).to_string();
        assert!(response.contains("Content-Type: text/javascript"));
        assert!(response.ends_with("\r\n\r\n"));
    }

    #[test]
    fn loopback_server_answers() {
        let host = start().unwrap();
        let addr = host.origin().trim_start_matches("http://").to_string();
        let mut stream = TcpStream::connect(addr).unwrap();
        stream.write_all(b"GET /fake.html HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains("text/html"));
    }
}
