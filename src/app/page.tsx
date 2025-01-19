import { DashboardHeader } from "@/components/dashboard/header";
import { MetricsChart } from "@/components/dashboard/metrics-chart";
import { db } from "@/lib/db";
import { metrics } from "@/lib/schema";
import { LighthouseTarget } from "@/types/metrics";
import { desc, eq } from "drizzle-orm";
import { syncLighthouseTargets } from "@/config/lighthouse-targets";

type Metric = {
  pageId: string;
  pageName: string;
  pageUrl: string;
  lcp: number;
  fid: number;
  cls: number;
  ttfb: number;
  inp: number;
  fcp: number;
};

export default async function Home() {
  // ページ情報をDBに同期してから取得
  const targets = await syncLighthouseTargets();

  // Lighthouse APIを呼び出してメトリクスを収集
  const apiMetrics = await collectMetrics(targets);

  // Supabaseにメトリクスを保存
  await Promise.all(
    apiMetrics.map(async (metric: Metric) => {
      await db.insert(metrics).values({
        pageId: metric.pageId,
        measuredAt: new Date(),
        lcp: String(metric.lcp),
        fid: String(metric.fid),
        cls: String(metric.cls),
        ttfb: String(metric.ttfb),
        inp: String(metric.inp),
        fcp: String(metric.fcp),
      });
    })
  );

  // 各ページの最新のメトリクスデータを取得
  const pageMetrics = await Promise.all(
    targets.map(async (page) => {
      const metricsData = await db
        .select()
        .from(metrics)
        .where(eq(metrics.pageId, page.pageId))
        .orderBy(desc(metrics.measuredAt))
        .limit(10);

      return {
        pageId: page.pageId,
        pageName: page.pageName,
        pageUrl: page.pageUrl,
        data: metricsData.map((metric) => ({
          measuredAt: metric.measuredAt.toISOString(),
          lcp: Number(metric.lcp),
          fid: Number(metric.fid),
          cls: Number(metric.cls),
          ttfb: Number(metric.ttfb),
          inp: Number(metric.inp),
          fcp: Number(metric.fcp),
        })),
      };
    })
  );

  return (
    <main className="mx-auto p-8">
      <DashboardHeader />
      {pageMetrics.map((pageMetric) => (
        <div key={pageMetric.pageId} className="mt-8">
          <h2 className="text-xl font-semibold mb-4">{pageMetric.pageName}</h2>
          <p className="text-sm text-gray-500 mb-4">{pageMetric.pageUrl}</p>
          <MetricsChart data={pageMetric.data} />
        </div>
      ))}
    </main>
  );
}

const collectMetrics: (
  targets: LighthouseTarget[]
) => Promise<Metric[]> = async (targets: LighthouseTarget[]) => {
  const metrics = await Promise.all(
    targets.map(async (target: LighthouseTarget) => {
      const response = await fetch(
        `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${target.pageUrl}&key=${process.env.GOOGLE_API_KEY}`
      );
      const data = await response.json();

      return {
        pageId: target.pageId,
        pageName: target.pageName,
        pageUrl: target.pageUrl,
        lcp: data.lighthouseResult.audits["largest-contentful-paint"]
          .numericValue,
        fid: data.lighthouseResult.audits["max-potential-fid"].numericValue,
        cls: data.lighthouseResult.audits["cumulative-layout-shift"]
          .numericValue,
        ttfb: data.lighthouseResult.audits["server-response-time"].numericValue,
        inp: data.lighthouseResult.audits["interactive"].numericValue,
        fcp: data.lighthouseResult.audits["first-contentful-paint"]
          .numericValue,
      };
    })
  );

  return metrics;
};
