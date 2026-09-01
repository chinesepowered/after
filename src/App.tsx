import { EnsureSignedIn } from "./auth";
import { matchRoute, RouterProvider, usePath } from "./router";
import { Home } from "./pages/Home";
import { Start } from "./pages/Start";
import { Board } from "./pages/Board";
import { Share } from "./pages/Share";
import { Print } from "./pages/Print";
import { Admin } from "./pages/Admin";

function Routes() {
  const route = matchRoute(usePath());
  switch (route.name) {
    case "home":
      return <Home />;
    case "start":
      return <Start />;
    case "board":
      return <Board slug={route.slug} />;
    case "share":
      return <Share slug={route.slug} />;
    case "print":
      return <Print slug={route.slug} />;
    case "admin":
      return <Admin />;
    default:
      return <Home />;
  }
}

export default function App() {
  return (
    <EnsureSignedIn>
      <RouterProvider>
        <Routes />
      </RouterProvider>
    </EnsureSignedIn>
  );
}
