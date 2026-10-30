import { Alert, App as AntApp, Button, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CopyOutlined, FileTextOutlined } from '@ant-design/icons';
import type { VerificationReport, VerificationStageResult } from '@/core/types/verification';
import { stageLabel, formatDuration } from '@/lib/format';
import { reportToJson, reportToMarkdown } from '@/lib/report';

const { Text } = Typography;

const STATUS_META: Record<
  VerificationStageResult['status'],
  { color: string; label: string }
> = {
  ok: { color: 'green', label: '通过' },
  failed: { color: 'red', label: '失败' },
  skipped: { color: 'default', label: '跳过' },
};

export interface VerificationReportViewProps {
  report?: VerificationReport;
  title?: string;
  compact?: boolean;
}

export function VerificationReportView({
  report,
  title = '验证报告',
  compact = false,
}: VerificationReportViewProps): JSX.Element | null {
  const { message } = AntApp.useApp();
  if (!report) return null;

  const columns: ColumnsType<VerificationStageResult> = [
    {
      title: '阶段',
      dataIndex: 'stage',
      render: (value: string) => <Text strong>{stageLabel(value)}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: VerificationStageResult['status']) => (
        <Tag color={STATUS_META[value].color}>{STATUS_META[value].label}</Tag>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 100,
      align: 'right',
      render: (value: number) => <span className="mono">{formatDuration(value)}</span>,
    },
    {
      title: '说明',
      dataIndex: 'detail',
      render: (value: string | undefined, record) => (
        <span>
          {value ?? '—'}
          {record.code && <Tag style={{ marginLeft: 8 }}>{record.code}</Tag>}
        </span>
      ),
    },
  ];

  const copyReport = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(reportToMarkdown(report, title));
      message.success('Markdown 报告已复制');
    } catch {
      message.error('复制失败');
    }
  };

  return (
    <div className={compact ? 'report-view report-view-compact' : 'report-view'}>
      <Alert
        type={report.ok ? 'success' : 'error'}
        showIcon
        message={report.ok ? '全部验证阶段通过' : '验证失败，已阻止输出明文'}
        description={
          <span>
            {report.summary}
            {report.errorCode && (
              <Tag color="red" style={{ marginLeft: 8 }}>
                {report.errorCode}
              </Tag>
            )}
          </span>
        }
      />
      <Table
        className="report-table"
        size="small"
        rowKey={(record, index) => `${record.stage}-${index}`}
        pagination={false}
        columns={columns}
        dataSource={[...report.stages]}
      />
      <Space className="report-actions">
        <Button size="small" icon={<CopyOutlined />} onClick={() => void copyReport()}>
          复制 Markdown 报告
        </Button>
        <Button
          size="small"
          icon={<FileTextOutlined />}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(reportToJson(report));
              message.success('JSON 报告已复制');
            } catch {
              message.error('复制失败');
            }
          }}
        >
          复制 JSON
        </Button>
      </Space>
    </div>
  );
}
