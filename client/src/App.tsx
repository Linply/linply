import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LocaleProvider } from "./i18n";
import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import InboxPage from "./pages/InboxPage";
import Channels from "./pages/Channels";
import Settings from "./pages/Settings";
import Plans from "./pages/Plans";
import PublicChat from "./pages/PublicChat";
import TicketList from "./pages/TicketList";
import TicketDetail from "./pages/TicketDetail";
import TicketCreate from "./pages/TicketCreate";
import SmartChat from "./pages/SmartChat";
import KnowledgeBase from "./pages/KnowledgeBase";
import AgentRunDetail from "./pages/AgentRunDetail";
import RagDebug from "./pages/RagDebug";
import AuthPage from "./pages/AuthPage";

function Router() {
  return (
    <Switch>
      {/* Public: the share link a workspace owner hands to their customers. */}
      <Route path={"/a/:publicKey"} component={PublicChat} />

      <Route path={"/login"}>
        <AuthPage mode="login" />
      </Route>
      <Route path={"/register"}>
        <AuthPage mode="register" />
      </Route>

      <Route path={"/"} component={Dashboard} />
      <Route path={"/onboarding"} component={Onboarding} />
      <Route path={"/inbox"} component={InboxPage} />
      <Route path={"/tickets"} component={TicketList} />
      <Route path={"/ticket/create"} component={TicketCreate} />
      <Route path={"/ticket/:id"} component={TicketDetail} />
      <Route path={"/chat"} component={SmartChat} />
      <Route path={"/runs/:runId"} component={AgentRunDetail} />
      <Route path={"/knowledge"} component={KnowledgeBase} />
      <Route path={"/channels"} component={Channels} />
      <Route path={"/settings"} component={Settings} />
      <Route path={"/plans"} component={Plans} />
      <Route path={"/rag-debug"} component={RagDebug} />

      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <LocaleProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </LocaleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
