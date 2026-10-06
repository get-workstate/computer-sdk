import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Link } from "react-router-dom";
import { Layout } from "@/components/layout";
import { EnvironmentPage } from "@/pages/environment";
import { EnvironmentsPage } from "@/pages/environments";
import { LivePage } from "@/pages/live";
import { RunPage } from "@/pages/run";
import { RunsPage } from "@/pages/runs";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout><EnvironmentsPage /></Layout>} />
        <Route path="/runs" element={<Layout><RunsPage /></Layout>} />
        <Route path="/runs/:id" element={<Layout><RunPage /></Layout>} />
        <Route path="/env/:name" element={<Layout><EnvironmentPage /></Layout>} />
        <Route path="/live/:name" element={<Layout width="wide"><LivePage /></Layout>} />
        <Route
          path="*"
          element={
            <Layout>
              <h1 className="font-serif text-4xl">That page isn't part of Workstate.</h1>
              <p className="mt-2 text-sm text-muted">The console lives on environments, runs, and the live view.</p>
              <Link className="mt-4 inline-block text-sm text-accent" to="/">
                Back to environments
              </Link>
            </Layout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
