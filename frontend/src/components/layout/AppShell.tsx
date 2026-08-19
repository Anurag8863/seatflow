import * as React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DesktopSidebar, SidebarBrand, SidebarNav } from './Sidebar';
import { Header } from './Header';

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const location = useLocation();

  // Any route change closes the drawer and returns the page to the top.
  React.useEffect(() => {
    setMobileNavOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="flex min-h-dvh bg-background">
      <DesktopSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenSidebar={() => setMobileNavOpen(true)} />
        <main id="main-content" className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent
          className="inset-y-0 left-0 right-auto bottom-auto top-0 h-dvh w-[17rem] max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none rounded-r-2xl p-0 sm:inset-y-0 sm:left-0 sm:top-0 sm:h-dvh sm:max-h-none sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:rounded-r-2xl data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:data-[state=closed]:slide-out-to-left sm:data-[state=open]:slide-in-from-left"
          hideClose
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <div className="flex h-14 items-center border-b border-border px-5">
            <SidebarBrand />
          </div>
          <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
