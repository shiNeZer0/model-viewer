//! 模型格式判定与 asset 协议授权计划。
//!
//! 本模块刻意只做**纯路径/字节计算**，不访问文件系统、不依赖 Tauri 运行时，
//! 因此可以被单元测试完整覆盖；真正的 IO 与 scope 落地在 `commands/asset.rs`。

use std::path::{Path, PathBuf};

/// 支持的三维模型扩展名（与前端 `src/constants/formats.js` 保持一致）
pub const SUPPORTED_EXTENSIONS: &[&str] = &["glb", "gltf", "fbx", "obj", "stl", "ply", "3mf"];

/// 单次运行最多授予的路径条目数，防止 scope 无限膨胀
pub const MAX_GRANTED_PATHS: usize = 32;

/// 探测文件格式时读取的头部字节数。
/// 需要 ≥84 字节才能校验二进制 STL 的面数头，512 字节也足够容纳 glTF/OBJ 的起始特征。
pub const PROBE_HEAD_BYTES: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelFormat {
    Glb,
    Gltf,
    Fbx,
    Obj,
    Stl,
    Ply,
    ThreeMf,
}

impl ModelFormat {
    pub fn from_extension(ext: &str) -> Option<Self> {
        let normalized = ext.trim_start_matches('.').to_ascii_lowercase();
        // 以 SUPPORTED_EXTENSIONS 作为唯一事实源，避免常量与 match 分支漂移
        if !SUPPORTED_EXTENSIONS.contains(&normalized.as_str()) {
            return None;
        }
        match normalized.as_str() {
            "glb" => Some(Self::Glb),
            "gltf" => Some(Self::Gltf),
            "fbx" => Some(Self::Fbx),
            "obj" => Some(Self::Obj),
            "stl" => Some(Self::Stl),
            "ply" => Some(Self::Ply),
            "3mf" => Some(Self::ThreeMf),
            _ => None,
        }
    }

    pub fn from_path(path: &Path) -> Option<Self> {
        path.extension()
            .and_then(|ext| ext.to_str())
            .and_then(Self::from_extension)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Glb => "glb",
            Self::Gltf => "gltf",
            Self::Fbx => "fbx",
            Self::Obj => "obj",
            Self::Stl => "stl",
            Self::Ply => "ply",
            Self::ThreeMf => "3mf",
        }
    }
}

/// 文本型格式（glTF/OBJ/ASCII STL）的头部按文本解读；NUL 之前视为有效区域。
fn head_as_text(head: &[u8]) -> String {
    let end = head.iter().position(|b| *b == 0).unwrap_or(head.len());
    let text = String::from_utf8_lossy(&head[..end]).to_string();
    // 去掉 UTF-8 BOM 与行首空白，避免误判
    text.trim_start_matches(['\u{feff}', ' ', '\t', '\r', '\n'])
        .to_string()
}

/// 二进制 STL：80 字节头 + 4 字节小端面数 + 每面 50 字节，长度必须严格自洽
fn looks_like_binary_stl(head: &[u8], file_len: u64) -> bool {
    if file_len < 84 || head.len() < 84 {
        return false;
    }
    let triangles = u32::from_le_bytes([head[80], head[81], head[82], head[83]]) as u64;
    84 + triangles * 50 == file_len
}

fn looks_like_obj(text: &str) -> bool {
    text.lines().take(20).any(|line| {
        let line = line.trim_end();
        const OBJ_PREFIXES: &[&str] = &[
            "v ", "vn ", "vt ", "f ", "o ", "g ", "s ", "mtllib ", "usemtl ",
        ];
        OBJ_PREFIXES.iter().any(|prefix| line.starts_with(prefix))
    })
}

/// 通过文件头部字节判断真实格式。`file_len` 用于二进制 STL 的长度自洽校验。
///
/// 返回 `None` 表示无法判定（此时以扩展名为准，前端会提示"无法校验"）。
pub fn sniff_format(head: &[u8], file_len: u64) -> Option<ModelFormat> {
    if head.len() >= 4 {
        if &head[0..4] == b"glTF" {
            return Some(ModelFormat::Glb);
        }
        if &head[0..4] == b"PK\x03\x04" {
            // 3MF 是 ZIP 容器（glb 等其他格式都不是）
            return Some(ModelFormat::ThreeMf);
        }
    }
    if head.starts_with(b"ply") {
        return Some(ModelFormat::Ply);
    }
    if head.starts_with(b"Kaydara FBX Binary") {
        return Some(ModelFormat::Fbx);
    }
    if looks_like_binary_stl(head, file_len) {
        return Some(ModelFormat::Stl);
    }

    let text = head_as_text(head);
    if text.starts_with('{') {
        // glTF 的 JSON 描述文件
        return Some(ModelFormat::Gltf);
    }
    if text.starts_with("; FBX") {
        // ASCII FBX 以注释行开头
        return Some(ModelFormat::Fbx);
    }
    if text.starts_with("solid") {
        return Some(ModelFormat::Stl);
    }
    if looks_like_obj(&text) {
        return Some(ModelFormat::Obj);
    }
    None
}

/// 是否为 ZIP 容器（3MF / 部分 GLB 变体无关，仅用于状态栏提示）
pub fn is_zip_container(head: &[u8]) -> bool {
    head.len() >= 4 && &head[0..4] == b"PK\x03\x04"
}

/// 扩展名文案：无扩展名时给出可读提示
pub fn extension_label(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"))
        .unwrap_or_else(|| "(无扩展名)".to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrantMode {
    /// 只授权文件本身（自包含格式够用）
    File,
    /// 授权父目录下的直接子项（不含子目录）
    Parent,
    /// 授权父目录整棵树（glTF 的 .bin、OBJ 的 .mtl 与贴图子目录需要）
    ParentRecursive,
}

impl GrantMode {
    /// 缺省值取 `ParentRecursive`：OBJ/glTF 的外部依赖常位于子目录中。
    /// 注意非法值**不**回退到默认值，而是报错，避免拼写错误被静默放大成更宽权限。
    pub fn parse(value: Option<&str>) -> Result<Self, GrantError> {
        match value {
            None => Ok(Self::ParentRecursive),
            Some(raw) => match raw.trim().to_ascii_lowercase().as_str() {
                "file" => Ok(Self::File),
                "parent" => Ok(Self::Parent),
                "parent-recursive" | "parent_recursive" => Ok(Self::ParentRecursive),
                other => Err(GrantError::InvalidGrantMode(other.to_string())),
            },
        }
    }

    pub fn is_recursive(&self) -> bool {
        matches!(self, Self::ParentRecursive)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GrantError {
    UnsupportedFormat(String),
    FileNotFound(PathBuf),
    NotAFile(PathBuf),
    PermissionDenied(PathBuf),
    RefusedProtectedDir(PathBuf),
    LimitExceeded(usize),
    InvalidGrantMode(String),
    Io(String),
    ScopeApply(String),
}

impl GrantError {
    /// 前端按 `CODE: 详情` 前缀做文案映射，因此这里的格式即对外契约。
    pub fn code(&self) -> String {
        match self {
            Self::UnsupportedFormat(ext) => format!("UNSUPPORTED_FORMAT: {ext}"),
            Self::FileNotFound(path) => format!("FILE_NOT_FOUND: {}", path.display()),
            Self::NotAFile(path) => format!("NOT_A_FILE: {}", path.display()),
            Self::PermissionDenied(path) => format!("PERMISSION_DENIED: {}", path.display()),
            Self::RefusedProtectedDir(path) => {
                format!("GRANT_REFUSED_PROTECTED_DIR: {}", path.display())
            }
            Self::LimitExceeded(limit) => format!("GRANT_LIMIT_EXCEEDED: {limit}"),
            Self::InvalidGrantMode(value) => format!("INVALID_GRANT_MODE: {value}"),
            Self::Io(message) => format!("IO_ERROR: {message}"),
            Self::ScopeApply(message) => format!("GRANT_APPLY_FAILED: {message}"),
        }
    }

    /// 把 `std::io::Error` 映射成语义化错误（权限不足单独区分，便于前端给出可操作提示）
    pub fn from_io(error: std::io::Error, path: &Path) -> Self {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            Self::PermissionDenied(path.to_path_buf())
        } else {
            Self::Io(error.to_string())
        }
    }
}

impl std::fmt::Display for GrantError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.code())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantPlan {
    pub file: PathBuf,
    pub format: ModelFormat,
    /// `None` 表示只授权文件本身
    pub dir: Option<PathBuf>,
    pub recursive: bool,
}

/// 纯路径计算，不访问文件系统（存在性/类型检查由调用方在 IO 层完成）
pub fn plan_grant(file: &Path, mode: GrantMode) -> Result<GrantPlan, GrantError> {
    let format = ModelFormat::from_path(file)
        .ok_or_else(|| GrantError::UnsupportedFormat(extension_label(file)))?;

    let (dir, recursive) = match mode {
        GrantMode::File => (None, false),
        GrantMode::Parent | GrantMode::ParentRecursive => {
            let dir = file
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .ok_or_else(|| GrantError::NotAFile(file.to_path_buf()))?;
            (Some(dir.to_path_buf()), mode.is_recursive())
        }
    };

    Ok(GrantPlan {
        file: file.to_path_buf(),
        format,
        dir,
        recursive,
    })
}

#[cfg(windows)]
fn normalize_for_compare(path: &Path) -> String {
    let mut text = path.to_string_lossy().replace('/', "\\").to_lowercase();
    // 保留 "E:\" 这类盘根，仅裁剪多余的尾部分隔符
    while text.len() > 3 && text.ends_with('\\') {
        text.pop();
    }
    text
}

#[cfg(not(windows))]
fn normalize_for_compare(path: &Path) -> String {
    let mut text = path.to_string_lossy().to_string();
    while text.len() > 1 && text.ends_with('/') {
        text.pop();
    }
    text
}

/// 受保护目录：盘根与用户主目录。
/// 对它们整树授权等于放开整个磁盘/用户空间，收益（OBJ 贴图）远小于风险。
pub fn is_protected_dir(dir: &Path, home: Option<&Path>) -> bool {
    if dir.parent().is_none() {
        return true;
    }
    match home {
        Some(home) => normalize_for_compare(dir) == normalize_for_compare(home),
        None => false,
    }
}

/// 在应用 scope 之前校验授权范围（目录模式才需要）
pub fn ensure_dir_grantable(plan: &GrantPlan, home: Option<&Path>) -> Result<(), GrantError> {
    if let Some(dir) = &plan.dir {
        if is_protected_dir(dir, home) {
            return Err(GrantError::RefusedProtectedDir(dir.clone()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head_of(bytes: &[u8]) -> Vec<u8> {
        bytes.to_vec()
    }

    #[test]
    fn format_from_extension_is_case_insensitive() {
        assert_eq!(ModelFormat::from_extension("GLB"), Some(ModelFormat::Glb));
        assert_eq!(ModelFormat::from_extension(".obj"), Some(ModelFormat::Obj));
        assert_eq!(ModelFormat::from_extension("3mf"), Some(ModelFormat::ThreeMf));
        assert_eq!(ModelFormat::from_extension("txt"), None);
        assert_eq!(
            ModelFormat::from_path(Path::new("E:\\models\\a.STL")),
            Some(ModelFormat::Stl)
        );
        assert_eq!(ModelFormat::from_path(Path::new("E:\\models\\a")), None);
    }

    #[test]
    fn sniff_detects_glb() {
        let head = head_of(b"glTF\x02\x00\x00\x00rest");
        assert_eq!(sniff_format(&head, 100), Some(ModelFormat::Glb));
    }

    #[test]
    fn sniff_detects_three_mf_zip() {
        let head = head_of(b"PK\x03\x04\x14\x00\x00\x00rest");
        assert_eq!(sniff_format(&head, 4096), Some(ModelFormat::ThreeMf));
        assert!(is_zip_container(&head));
    }

    #[test]
    fn sniff_detects_ply_and_fbx() {
        assert_eq!(
            sniff_format(b"ply\nformat ascii 1.0\n", 64),
            Some(ModelFormat::Ply)
        );
        assert_eq!(
            sniff_format(b"Kaydara FBX Binary  \x00\x1a\x00", 2048),
            Some(ModelFormat::Fbx)
        );
        assert_eq!(
            sniff_format(b"; FBX 7.4.0 project file\n", 512),
            Some(ModelFormat::Fbx)
        );
    }

    #[test]
    fn sniff_detects_binary_stl_by_length_math() {
        // 84 + 2 * 50 = 184
        let mut head = vec![0u8; 84];
        head[80..84].copy_from_slice(&2u32.to_le_bytes());
        assert_eq!(sniff_format(&head, 184), Some(ModelFormat::Stl));
        // 长度不自洽时不能判定为二进制 STL
        assert_eq!(sniff_format(&head, 200), None);
    }

    #[test]
    fn sniff_detects_ascii_stl_and_gltf_and_obj() {
        assert_eq!(
            sniff_format(b"solid cube\n  facet normal 0 0 1\n", 200),
            Some(ModelFormat::Stl)
        );
        assert_eq!(
            sniff_format(b"{\n  \"asset\": { \"version\": \"2.0\" }\n", 300),
            Some(ModelFormat::Gltf)
        );
        assert_eq!(
            sniff_format(b"# Blender\nmtllib cube.mtl\nv 1.0 1.0 1.0\n", 300),
            Some(ModelFormat::Obj)
        );
        assert_eq!(sniff_format(b"v 0 0 0\nvn 0 0 1\n", 64), Some(ModelFormat::Obj));
    }

    #[test]
    fn sniff_returns_none_for_unknown_content() {
        assert_eq!(sniff_format(b"hello world, not a model", 64), None);
        assert_eq!(sniff_format(&[], 0), None);
    }

    /// 与前端 `src/platform/sniff.js` 共享同一份测试向量。
    /// Web 版没有 Rust 后端，只能在前端重写一遍嗅探规则，这个用例是防止两端漂移的闸门。
    #[test]
    fn sniff_matches_shared_fixture() {
        fn decode_hex(hex: &str) -> Vec<u8> {
            assert!(hex.len() % 2 == 0, "十六进制长度必须是偶数");
            (0..hex.len())
                .step_by(2)
                .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).expect("非法十六进制"))
                .collect()
        }

        let raw = include_str!("../../tests/fixtures/format-sniff-cases.json");
        let fixture: serde_json::Value =
            serde_json::from_str(raw).expect("测试向量 JSON 解析失败");
        let cases = fixture["cases"].as_array().expect("cases 必须是数组");
        assert!(!cases.is_empty(), "测试向量不能为空");

        for case in cases {
            let name = case["name"].as_str().unwrap_or("<未命名>");
            let head = decode_hex(case["hex"].as_str().unwrap_or(""));
            let file_len = case["fileLen"].as_u64().expect("fileLen 必须是数字");
            let expected = case["expected"].as_str().map(|id| {
                ModelFormat::from_extension(id).unwrap_or_else(|| panic!("未知格式 id: {id}"))
            });

            assert_eq!(
                sniff_format(&head, file_len),
                expected,
                "共享向量中的用例「{name}」判定不一致"
            );
        }
    }

    #[test]
    fn head_text_stops_at_nul_and_strips_bom() {
        let mut head = vec![0xef, 0xbb, 0xbf];
        head.extend_from_slice(b"solid x");
        head.push(0);
        head.extend_from_slice(b"garbage");
        assert_eq!(sniff_format(&head, 128), Some(ModelFormat::Stl));
    }

    #[test]
    fn grant_mode_parse_defaults_and_rejects_invalid() {
        assert_eq!(GrantMode::parse(None), Ok(GrantMode::ParentRecursive));
        assert_eq!(GrantMode::parse(Some("FILE")), Ok(GrantMode::File));
        assert_eq!(GrantMode::parse(Some("parent")), Ok(GrantMode::Parent));
        assert_eq!(
            GrantMode::parse(Some(" parent-recursive ")),
            Ok(GrantMode::ParentRecursive)
        );
        assert_eq!(
            GrantMode::parse(Some("parent_recursive")),
            Ok(GrantMode::ParentRecursive)
        );
        assert_eq!(
            GrantMode::parse(Some("everything")),
            Err(GrantError::InvalidGrantMode("everything".to_string()))
        );
    }

    #[test]
    fn plan_grant_file_mode_grants_single_file() {
        let plan = plan_grant(Path::new("E:\\models\\robot.glb"), GrantMode::File).unwrap();
        assert_eq!(plan.format, ModelFormat::Glb);
        assert_eq!(plan.dir, None);
        assert!(!plan.recursive);
    }

    #[test]
    fn plan_grant_parent_modes() {
        let plan = plan_grant(Path::new("E:\\models\\robot.obj"), GrantMode::Parent).unwrap();
        assert_eq!(plan.dir, Some(PathBuf::from("E:\\models")));
        assert!(!plan.recursive);

        let plan =
            plan_grant(Path::new("E:\\models\\robot.obj"), GrantMode::ParentRecursive).unwrap();
        assert_eq!(plan.dir, Some(PathBuf::from("E:\\models")));
        assert!(plan.recursive);
    }

    #[test]
    fn plan_grant_rejects_unsupported_extension() {
        let err = plan_grant(Path::new("E:\\models\\notes.txt"), GrantMode::File).unwrap_err();
        assert_eq!(err.code(), "UNSUPPORTED_FORMAT: .txt");
        let err = plan_grant(Path::new("E:\\models\\notes"), GrantMode::File).unwrap_err();
        assert_eq!(err.code(), "UNSUPPORTED_FORMAT: (无扩展名)");
    }

    #[test]
    fn protected_dir_detects_drive_root() {
        #[cfg(windows)]
        {
            assert!(is_protected_dir(Path::new("E:\\"), None));
            assert!(!is_protected_dir(Path::new("E:\\models"), None));
        }
        #[cfg(not(windows))]
        {
            assert!(is_protected_dir(Path::new("/"), None));
            assert!(!is_protected_dir(Path::new("/home/user/models"), None));
        }
    }

    #[test]
    fn protected_dir_detects_home_directory() {
        #[cfg(windows)]
        {
            let home = Path::new("C:\\Users\\shunz");
            assert!(is_protected_dir(Path::new("C:\\Users\\shunz"), Some(home)));
            // 大小写与尾部分隔符不应影响判定
            assert!(is_protected_dir(Path::new("c:\\users\\SHUNZ\\"), Some(home)));
            assert!(!is_protected_dir(Path::new("C:\\Users\\shunz\\models"), Some(home)));
        }
        #[cfg(not(windows))]
        {
            let home = Path::new("/home/shunz");
            assert!(is_protected_dir(Path::new("/home/shunz"), Some(home)));
            assert!(is_protected_dir(Path::new("/home/shunz/"), Some(home)));
            assert!(!is_protected_dir(Path::new("/home/shunz/models"), Some(home)));
        }
    }

    #[test]
    fn ensure_dir_grantable_rejects_protected_dir_only() {
        #[cfg(windows)]
        {
            let home = Path::new("C:\\Users\\shunz");

            // 普通目录：允许整树授权
            let plan =
                plan_grant(Path::new("E:\\models\\robot.glb"), GrantMode::ParentRecursive).unwrap();
            assert!(ensure_dir_grantable(&plan, Some(home)).is_ok());

            // 文件就在盘根下：父目录是盘根，同样受保护
            let plan = plan_grant(Path::new("E:\\robot.glb"), GrantMode::ParentRecursive).unwrap();
            let error = ensure_dir_grantable(&plan, Some(home)).unwrap_err();
            assert!(error.code().starts_with("GRANT_REFUSED_PROTECTED_DIR"));

            // 文件在主目录下：受保护
            let plan =
                plan_grant(Path::new("C:\\Users\\shunz\\robot.glb"), GrantMode::ParentRecursive)
                    .unwrap();
            let error = ensure_dir_grantable(&plan, Some(home)).unwrap_err();
            assert!(error.code().starts_with("GRANT_REFUSED_PROTECTED_DIR"));

            // 只授权单文件时不做目录保护判定（前端会退化为这种模式）
            let plan = plan_grant(Path::new("C:\\Users\\shunz\\robot.glb"), GrantMode::File).unwrap();
            assert!(ensure_dir_grantable(&plan, Some(home)).is_ok());
            let plan = plan_grant(Path::new("E:\\robot.glb"), GrantMode::File).unwrap();
            assert!(ensure_dir_grantable(&plan, Some(home)).is_ok());
        }
    }

    #[test]
    fn error_codes_are_stable_contract() {
        assert_eq!(
            GrantError::FileNotFound(PathBuf::from("E:\\a.glb")).code(),
            "FILE_NOT_FOUND: E:\\a.glb"
        );
        assert_eq!(
            GrantError::NotAFile(PathBuf::from("E:\\dir")).code(),
            "NOT_A_FILE: E:\\dir"
        );
        assert_eq!(
            GrantError::PermissionDenied(PathBuf::from("E:\\a.glb")).code(),
            "PERMISSION_DENIED: E:\\a.glb"
        );
        assert_eq!(GrantError::LimitExceeded(MAX_GRANTED_PATHS).code(), "GRANT_LIMIT_EXCEEDED: 32");
        assert_eq!(GrantError::Io("磁盘错误".to_string()).code(), "IO_ERROR: 磁盘错误");
    }
}
