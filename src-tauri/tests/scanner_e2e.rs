//! E2E test against real ~/.claude/plugins/installed_plugins.json
//! Verifies scanner fix returns real plugins, not infra dirs.

use claude_config_manager_lib::infrastructure::resource_scanner::scan_resources;
use claude_config_manager_lib::domain::resource::ResourceKind;
use std::path::Path;

#[test]
fn e2e_real_installed_plugins_json_returns_real_plugins() {
    let home = std::env::var("HOME").expect("HOME not set");
    let claude_dir = Path::new(&home).join(".claude");
    if !claude_dir.exists() {
        eprintln!("SKIP: ~/.claude/ does not exist on this machine");
        return;
    }
    let items = scan_resources(&claude_dir, ResourceKind::Plugin)
        .expect("scan_resources Plugin arm should succeed");
    
    eprintln!("[e2e] returned {} plugin items", items.len());
    for item in &items {
        eprintln!("[e2e]   id={} name={} path={} source_repo={:?}",
            item.id, item.name, item.path,
            item.source_repo.as_deref().unwrap_or("(none)"));
    }
    
    // Hard assertions — real installed plugins appear
    assert!(items.iter().any(|i| i.name.contains("superpowers")), "expected superpowers plugin");
    assert!(items.iter().any(|i| i.name.contains("memsearch")), "expected memsearch plugin");
    assert!(items.iter().any(|i| i.name.contains("context7")), "expected context7 plugin");
    
    // Hard assertions — infra dirs do NOT appear
    assert!(!items.iter().any(|i| i.name == "data"), "data/ infra dir MUST NOT appear as plugin");
    assert!(!items.iter().any(|i| i.name == "marketplaces"), "marketplaces/ infra dir MUST NOT appear");
    assert!(!items.iter().any(|i| i.name == "cache"), "cache/ infra dir MUST NOT appear");
    
    // Hard assertion — paths point to cache installPath, not top-level
    for item in &items {
        assert!(item.path.contains("/cache/"), 
            "plugin path should be in /cache/, got {}", item.path);
    }
}
