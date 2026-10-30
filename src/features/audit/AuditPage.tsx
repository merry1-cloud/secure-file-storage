import { useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ClearOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import type { AuditEntry } from '@/core/types/audit';
import { listAudit } from '@/core/audit/auditService';
import { clearAuditEntries } from '@/core/storage/repositories/auditRepo';
import { downloadJson } from '@/lib/download';
import { errorText } from '@/lib/errors';
import {
  auditActionLabel,
  formatDate,
  shortFingerprint,
  stageLabel,
} from '@/lib/format';

const { Text, Title } = Typography;

export function AuditPage(): JSX.Element {
  const { message } = AntApp.useApp();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      setEntries(await listAudit(500));
      setError(undefined);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const clear = async (): Promise<void> => {
    try {
      await clearAuditEntries();
      await load();
      message.success('审计日志已清空');
    } catch (err) {
      message.error(errorText(err));
    }
  };

  const columns: ColumnsType<AuditEntry> = [
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 190,
      render: (value: number) => <span className="mono small-mono">{formatDate(value)}</span>,
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: 150,
      render: (value: string) => <Text strong>{auditActionLabel(value)}</Text>,
    },
    {
      title: '结果',
      dataIndex: 'result',
      key: 'result',
      width: 90,
      render: (value: string) =>
        value === 'success' ? (
          <Tag color="success">成功</Tag>
        ) : (
          <Tag color="error">失败</Tag>
        ),
    },
    {
      title: '阶段',
      dataIndex: 'stage',
      key: 'stage',
      width: 110,
      render: (value?: string) => (value ? <Tag>{stageLabel(value)}</Tag> : '—'),
    },
    {
      title: '错误码',
      dataIndex: 'errorCode',
      key: 'errorCode',
      width: 180,
      render: (value?: string) => (value ? <Text className="mono">{value}</Text> : '—'),
    },
    {
      title: '文件',
      dataIndex: 'fileId',
      key: 'fileId',
      width: 150,
      render: (value?: string) => (value ? <span className="mono">{shortFingerprint(value)}</span> : '—'),
    },
    {
      title: '详情',
      dataIndex: 'detail',
      key: 'detail',
      render: (value?: Record<string, unknown>) =>
        value ? (
          <Text type="secondary" className="small-mono">
            {JSON.stringify(value)}
          </Text>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="page-stack">
      <Alert
        type="info"
        showIcon
        icon={<SafetyOutlined />}
        message="仅记录操作元数据"
        description="不含口令、密钥或明文；仅存本机。"
      />

      <Card
        className="audit-card"
        bordered={false}
        title={
          <Space>
            <SafetyOutlined />
            <Title level={4} style={{ margin: 0 }}>操作审计</Title>
            <Tag>{entries.length}</Tag>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
              刷新
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={entries.length === 0}
              onClick={() =>
                downloadJson(entries, `audit-${new Date().toISOString().slice(0, 10)}.json`)
              }
            >
              导出 JSON
            </Button>
            <Popconfirm
              title="清空全部审计日志？"
              description="不会删除文件或密钥，但历史记录不可恢复。"
              okText="清空"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void clear()}
            >
              <Button danger icon={<ClearOutlined />} disabled={entries.length === 0}>
                清空
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
        <Table
          rowKey={(record) => String(record.id ?? `${record.timestamp}-${record.action}`)}
          size="small"
          loading={loading}
          columns={columns}
          dataSource={entries}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 12, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>
    </div>
  );
}
