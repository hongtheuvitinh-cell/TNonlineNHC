/**
 * Dịch vụ điều hướng cuộn trang bằng bàn phím (ArrowUp, ArrowDown, PageUp, PageDown, Home, End, Space)
 * và tối ưu hóa điều hướng cuộn cho Ngân hàng câu hỏi, Soạn đề thi, Xem trước đề thi, Làm bài thi.
 */

export function isUserEditingText(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
  return false;
}

let lastHoveredScrollable: HTMLElement | null = null;

export function getActiveScrollContainer(): HTMLElement | Window {
  // 1. Nếu chuột đang rê vào một khung cuộn cụ thể và khung đó có thể cuộn được
  if (
    lastHoveredScrollable && 
    document.body.contains(lastHoveredScrollable) && 
    lastHoveredScrollable.scrollHeight > lastHoveredScrollable.clientHeight
  ) {
    return lastHoveredScrollable;
  }

  // 2. Kiểm tra modal đang mở (có lớp fixed/absolute và có overflow-y-auto)
  const openModals = Array.from(document.querySelectorAll<HTMLElement>(
    '.fixed .overflow-y-auto, [role="dialog"] .overflow-y-auto, [data-scroll-container="true"]'
  )).filter(el => {
    return (el.clientHeight > 0 || el.offsetHeight > 0) && el.scrollHeight > el.clientHeight;
  });

  if (openModals.length > 0) {
    return openModals[openModals.length - 1];
  }

  // 3. Khung cuộn chính của Admin Dashboard (#admin-main-scroll)
  const adminMain = document.getElementById('admin-main-scroll');
  if (adminMain && adminMain.scrollHeight > adminMain.clientHeight) {
    return adminMain;
  }

  // 4. Bất kỳ thẻ main có overflow-y-auto
  const mainEl = document.querySelector<HTMLElement>('main.overflow-y-auto');
  if (mainEl && mainEl.scrollHeight > mainEl.clientHeight) {
    return mainEl;
  }

  // 5. Fallback về cửa sổ trang web (cho học sinh / QuizTaker)
  return window;
}

export function scrollActiveContainer(deltaY: number, behavior: ScrollBehavior = 'smooth') {
  const container = getActiveScrollContainer();
  if (container === window) {
    window.scrollBy({ top: deltaY, behavior });
  } else {
    container.scrollBy({ top: deltaY, behavior });
  }
}

export function scrollToActiveContainerTop() {
  const container = getActiveScrollContainer();
  if (container === window) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    container.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

export function scrollToActiveContainerBottom() {
  const container = getActiveScrollContainer();
  if (container === window) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  } else {
    container.scrollTo({ top: (container as HTMLElement).scrollHeight, behavior: 'smooth' });
  }
}

/**
 * Khởi tạo bộ lắng nghe phím điều hướng toàn cục.
 * Tự động gắn vào window khi ứng dụng chạy.
 */
export function initGlobalKeyboardScroll(): () => void {
  if (typeof window === 'undefined') return () => {};

  // Ghi nhận vùng cuộn đang được rê chuột
  const handleMouseOver = (e: MouseEvent) => {
    let target = e.target as HTMLElement | null;
    while (target && target !== document.body) {
      if (target.scrollHeight > target.clientHeight + 10) {
        const style = window.getComputedStyle(target);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          lastHoveredScrollable = target;
          return;
        }
      }
      target = target.parentElement;
    }
  };

  // Tự động nhả focus khỏi các input khi click vào vùng trống
  const handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const isInteractive = 
      target.tagName === 'INPUT' || 
      target.tagName === 'TEXTAREA' || 
      target.tagName === 'SELECT' || 
      target.tagName === 'BUTTON' || 
      target.tagName === 'A' || 
      target.closest('button') || 
      target.closest('a') ||
      target.isContentEditable;

    if (!isInteractive && isUserEditingText(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Nếu người dùng đang gõ trong input, textarea hoặc contenteditable thì không can thiệp
    if (isUserEditingText(document.activeElement) || isUserEditingText(e.target)) {
      return;
    }

    // Không can thiệp nếu đang nhấn tổ hợp phím Ctrl, Alt, Meta (Cmd)
    if (e.ctrlKey || e.altKey || e.metaKey) {
      return;
    }

    const key = e.key;

    if (key === 'ArrowDown') {
      e.preventDefault();
      scrollActiveContainer(90, 'smooth');
    } else if (key === 'ArrowUp') {
      e.preventDefault();
      scrollActiveContainer(-90, 'smooth');
    } else if (key === 'PageDown') {
      e.preventDefault();
      scrollActiveContainer(450, 'smooth');
    } else if (key === 'PageUp') {
      e.preventDefault();
      scrollActiveContainer(-450, 'smooth');
    } else if (key === 'Home') {
      e.preventDefault();
      scrollToActiveContainerTop();
    } else if (key === 'End') {
      e.preventDefault();
      scrollToActiveContainerBottom();
    } else if (key === ' ' && !e.shiftKey) {
      e.preventDefault();
      scrollActiveContainer(400, 'smooth');
    } else if (key === ' ' && e.shiftKey) {
      e.preventDefault();
      scrollActiveContainer(-400, 'smooth');
    }
  };

  window.addEventListener('mouseover', handleMouseOver, { passive: true });
  window.addEventListener('click', handleClick, { passive: true });
  window.addEventListener('keydown', handleKeyDown, { passive: false });

  return () => {
    window.removeEventListener('mouseover', handleMouseOver);
    window.removeEventListener('click', handleClick);
    window.removeEventListener('keydown', handleKeyDown);
  };
}
