import ChannelReportClient from "./ChannelReportClient";

export const dynamic = "force-dynamic";

export default async function ChannelPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <ChannelReportClient encodedName={name} />;
}
