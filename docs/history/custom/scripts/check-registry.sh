#!/usr/bin/env bash
# =============================================================================
# check-registry.sh — 代码 CUSTOM 标记 ↔ registry.md 改动总览 一致性自检
# 用法（Git Bash）：sh CUSTOMIZATIONS/scripts/check-registry.sh
# 退出码：0 一致；1 有差异（按提示修文档或补标记）
# 适配 sidex 多语言仓库：扫描 src/（TS）、src-tauri/ 与 crates/（Rust）、
# sidexai/（Go）、src-wasm/、extensions-rust/、scripts/ 及根配置文件
# =============================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REGISTRY="${PROJECT_ROOT}/CUSTOMIZATIONS/registry.md"

# 收集代码中的 CUSTOM 标记：file -> 排序去重的 change-id 集合
# 排除：registry.md 自身、测试文件（测试不强制标记）、node_modules、构建产物
declare -A CODE_MARKERS=()
while IFS= read -r line; do
  file="${line%%:*}"
  rest="${line#*:}"
  id=""
  if [[ "$rest" =~ CUSTOM-([0-9]{8}-[0-9]{3}) ]]; then
    id="CUSTOM-${BASH_REMATCH[1]}"
  else
    continue
  fi
  # 归一化路径分隔符
  file="${file//\\//}"
  CODE_MARKERS["$file"]+="$id "
done < <(grep -rn "CUSTOM-BEGIN" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.rs" \
  --include="*.go" --include="*.toml" --include="*.html" --include="*.vue" \
  --include="*.yml" --include="*.yaml" --include="*.sh" --include="*.json" \
  --include=".gitignore" \
  "${PROJECT_ROOT}/src" "${PROJECT_ROOT}/src-tauri" "${PROJECT_ROOT}/crates" \
  "${PROJECT_ROOT}/sidexai" "${PROJECT_ROOT}/src-wasm" "${PROJECT_ROOT}/extensions-rust" \
  "${PROJECT_ROOT}/CUSTOMIZATIONS" "${PROJECT_ROOT}/scripts" \
  "${PROJECT_ROOT}/.gitignore" "${PROJECT_ROOT}/package.json" \
  "${PROJECT_ROOT}/vite.config.ts" "${PROJECT_ROOT}/index.html" 2>/dev/null \
  | grep -v node_modules | grep -v "/target/" | grep -v "/dist/" | grep -v "/out/" \
  | grep -v "\.test\." | grep -v "\.spec\." | grep -v "registry.md" || true)

# 从 registry.md 改动总览表收集已登记文件
# 总览表以「## 改动总览」开头、「## 变更日志」结尾
# DOC_FILES: 精确文件路径（参与 §2 严格校验）
# DOC_PREFIXES: 目录前缀（聚合行/通配行，仅参与 §1 前缀匹配）
declare -A DOC_FILES=()
declare -A DOC_PREFIXES=()
in_table=false
while IFS= read -r line; do
  if [[ "$line" == "## 改动总览"* ]]; then in_table=true; continue; fi
  if [[ "$line" == "## 变更日志"* ]]; then break; fi
  if $in_table && [[ "$line" == \|* ]]; then
    file="$(echo "$line" | awk -F'|' '{gsub(/^ +| +$/, "", $2); print $2}')"
    [[ "$file" == "" || "$file" == 文件* || "$file" == --* ]] && continue
    # 聚合行「DIR/（a、b、c）」或通配「DIR/*」：登记目录前缀
    if [[ "$file" == *"（"* || "$file" == *"*"* ]]; then
      prefix="${file%%（*}"; prefix="${prefix%%\**}"
      prefix="$(echo "$prefix" | sed 's/^ *//;s/ *$//')"
      [[ "$prefix" == */ || "$prefix" == "" ]] && DOC_PREFIXES["${prefix%/}"]=1 || DOC_PREFIXES["$prefix"]=1
      continue
    fi
    # 一行聚合多个文件（、分隔）时拆开逐个登记
    IFS='、' read -r -a parts <<< "$file"
    for p in "${parts[@]}"; do
      p="$(echo "$p" | sed 's/^ *//;s/ *$//')"
      [[ "$p" == "" ]] && continue
      DOC_FILES["$p"]=1
    done
  fi
done < "${REGISTRY}"

errors=0
echo "== 1) 代码里有 CUSTOM 标记但总览表未登记（或路径写法对不上）=="
for file in "${!CODE_MARKERS[@]}"; do
  rel="${file#"${PROJECT_ROOT}/"}"
  found=0
  for doc in "${!DOC_FILES[@]}"; do
    [[ "$rel" == "$doc" ]] && { found=1; break; }
    # 相对通配行（如 src/vs/workbench/contrib/*）
    if [[ "$doc" == *"*"* ]]; then
      wprefix="${doc%%\**}"
      [[ "$rel" == "${wprefix}"* ]] && { found=1; break; }
    fi
  done
  if [[ $found -eq 0 ]]; then
    for prefix in "${!DOC_PREFIXES[@]}"; do
      [[ "$rel" == "${prefix}"/* || "$rel" == "$prefix" ]] && { found=1; break; }
    done
  fi
  if [[ $found -eq 0 ]]; then
    echo "  [MISSING-IN-DOC] $rel  (标记: $(echo "${CODE_MARKERS[$file]}" | tr ' ' '\n' | sort -u | tr '\n' ' '))"
    errors=$((errors+1))
  fi
done
[[ $errors -eq 0 ]] && echo "  (全部已登记)"

echo ""
echo "== 2) 总览表登记的上游文件但代码里找不到对应标记 =="
# 仅校验精确路径行；纯自定义路径（上游不存在）与测试文件不要求标记
is_custom_only() {
  case "$1" in
    CUSTOMIZATIONS/*|.agents/*|AGENTS.md|CLAUDE.md|.gitignore|eslint.config.js) return 0 ;;
    package-lock.json|Cargo.lock) return 0 ;;
    *.json|*.test.*|*.spec.*|*.test.tsx) return 0 ;;
    *) return 1 ;;
  esac
}
for doc in "${!DOC_FILES[@]}"; do
  is_custom_only "$doc" && continue
  abs="${PROJECT_ROOT}/${doc}"
  if [[ ! -f "$abs" ]]; then
    echo "  [FILE-NOT-FOUND] $doc"
    errors=$((errors+1))
    continue
  fi
  if ! grep -q "CUSTOM-BEGIN" "$abs" 2>/dev/null; then
    echo "  [NO-MARKER] $doc（若确属无标记的已知缺口，请在总览标注「无标记」）"
    errors=$((errors+1))
  fi
done

echo ""
if [[ $errors -eq 0 ]]; then
  echo "[OK] 代码标记与改动总览一致（${#CODE_MARKERS[@]} 个含标记文件均已登记）"
  exit 0
else
  echo "[DIFF] 发现 $errors 处不一致——修文档（路径写法对齐）或补代码标记后重跑"
  exit 1
fi
