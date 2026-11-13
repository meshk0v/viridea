import { useEffect } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { StoreProvider } from './store.jsx';
import { ShopLayout, Home, Catalog, Product } from './shop/Shop.jsx';
import { Cart, Checkout, Account, Replace, Info, NotFound } from './shop/Shop2.jsx';
import { AdminLayout, Dashboard, Users, Audit, Tests } from './admin/Admin.jsx';
import { CatalogAdmin, ImportAdmin, SuppliesAdmin, StockAdmin, AdaptationAdmin } from './admin/Ops.jsx';
import { OrdersAdmin, OrderDetail, ClaimsAdmin } from './admin/Orders.jsx';
import { FinanceAdmin, SyncAdmin, ApiAdmin } from './admin/Fin.jsx';

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  return (
    <StoreProvider>
      <HashRouter>
        <ScrollTop />
        <Routes>
          <Route element={<ShopLayout />}>
            <Route index element={<Home />} />
            <Route path="catalog" element={<Catalog />} />
            <Route path="p/:sku" element={<Product />} />
            <Route path="cart" element={<Cart />} />
            <Route path="checkout" element={<Checkout />} />
            <Route path="account" element={<Account />} />
            <Route path="replace/:token" element={<Replace />} />
            <Route path="info/:page" element={<Info />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="catalog" element={<CatalogAdmin />} />
            <Route path="import" element={<ImportAdmin />} />
            <Route path="supplies" element={<SuppliesAdmin />} />
            <Route path="stock" element={<StockAdmin />} />
            <Route path="adaptation" element={<AdaptationAdmin />} />
            <Route path="orders" element={<OrdersAdmin />} />
            <Route path="orders/:id" element={<OrderDetail />} />
            <Route path="claims" element={<ClaimsAdmin />} />
            <Route path="finance" element={<FinanceAdmin />} />
            <Route path="sync" element={<SyncAdmin />} />
            <Route path="api" element={<ApiAdmin />} />
            <Route path="audit" element={<Audit />} />
            <Route path="users" element={<Users />} />
            <Route path="tests" element={<Tests />} />
          </Route>
        </Routes>
      </HashRouter>
    </StoreProvider>
  );
}
