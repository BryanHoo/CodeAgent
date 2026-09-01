#[cfg(windows)]
mod platform {
    use std::sync::atomic::{AtomicBool, Ordering};

    use windows::{
        Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
        core::{s, w},
    };

    const ALLOC_CONSOLE_MODE_NO_WINDOW: i32 = 2;
    const ALLOC_CONSOLE_RESULT_NEW_CONSOLE: i32 = 1;
    const ALLOC_CONSOLE_RESULT_EXISTING_CONSOLE: i32 = 2;
    static HAS_HIDDEN_CONSOLE: AtomicBool = AtomicBool::new(false);

    #[repr(C)]
    struct AllocConsoleOptions {
        mode: i32,
        use_show_window: i32,
        show_window: u16,
    }
    const _: () = assert!(std::mem::size_of::<AllocConsoleOptions>() == 12);

    type AllocConsoleWithOptions =
        unsafe extern "system" fn(*const AllocConsoleOptions, *mut i32) -> i32;

    pub fn initialize_hidden_console() {
        let initialized = unsafe { allocate_hidden_console() };
        HAS_HIDDEN_CONSOLE.store(initialized, Ordering::Release);
    }

    pub fn has_hidden_console() -> bool {
        HAS_HIDDEN_CONSOLE.load(Ordering::Acquire)
    }

    unsafe fn allocate_hidden_console() -> bool {
        // Resolve dynamically so the application still starts on Windows versions before 11 24H2.
        let Ok(kernel32) = (unsafe { GetModuleHandleW(w!("kernel32.dll")) }) else {
            return false;
        };
        let Some(address) = (unsafe { GetProcAddress(kernel32, s!("AllocConsoleWithOptions")) })
        else {
            return false;
        };
        // SAFETY: the symbol name and ABI match AllocConsoleWithOptions from ConsoleApi.h.
        let allocate: AllocConsoleWithOptions = unsafe { std::mem::transmute(address) };
        let options = AllocConsoleOptions {
            mode: ALLOC_CONSOLE_MODE_NO_WINDOW,
            use_show_window: 0,
            show_window: 0,
        };
        let mut result = 0;
        // SAFETY: both pointers remain valid for the duration of the synchronous system call.
        let status = unsafe { allocate(&options, &mut result) };
        status >= 0
            && matches!(
                result,
                ALLOC_CONSOLE_RESULT_NEW_CONSOLE | ALLOC_CONSOLE_RESULT_EXISTING_CONSOLE
            )
    }
}

#[cfg(windows)]
pub use platform::{has_hidden_console, initialize_hidden_console};

#[cfg(not(windows))]
pub fn initialize_hidden_console() {}

#[cfg(not(windows))]
pub fn has_hidden_console() -> bool {
    false
}
