use super::*;

#[test]
fn recovery_should_bound_entries_and_retain_active_leases() {
    let registry = QueuedSteerRegistry::default();
    let active = registry.acquire([0; 32]).unwrap();
    for index in 1..CAPACITY {
        registry.acquire([index as u8; 32]).unwrap();
    }
    assert_eq!(
        registry.acquire([255; 32]).err().unwrap()["code"],
        "IDEMPOTENCY_CAPACITY_EXCEEDED"
    );
    assert!(Arc::ptr_eq(&active, &registry.acquire([0; 32]).unwrap()));
    for entry in registry.entries.lock().unwrap().values_mut() {
        entry.created = Instant::now() - RETENTION;
    }
    registry.acquire([255; 32]).unwrap();
    assert_eq!(registry.entries.lock().unwrap().len(), 2);
    assert!(Arc::ptr_eq(&active, &registry.acquire([0; 32]).unwrap()));
    drop(active);
    registry.acquire([254; 32]).unwrap();
    assert!(!registry.entries.lock().unwrap().contains_key(&[0; 32]));
}
