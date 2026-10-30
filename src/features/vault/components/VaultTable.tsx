import { Button, Empty, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  DownloadOutlined,
  ExportOutlined,
  EyeOutlined,
  FileOutlined,
  SafetyCertificateOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import type { StoredFileRecord } from '@/core/storage/schema';
import { formatBytes, formatDate, shortFingerprint } from '@/lib/format';

const { Text } = Typography;

export interface VaultTableProps {
  files: StoredFileRecord[];
  loading?: boolean;
  onDecrypt(file: StoredFileRecord): void;
  onVerify(file: StoredFileRecord): void;
  onExport(file: StoredFileRecord): void;
  onDetails(file: StoredFileRecord): void;
  onDelete(file: StoredFileRecord): void;
}

export function VaultTable({
  files,
  loading,
  onDecrypt,
  onVerify,
  onExport,
  onDetails,
  onDelete,
}: VaultTableProps): JSX.Element {
  const columns: ColumnsType<StoredFileRecord> = [
    {
      title: '文件名',
      dataIndex: 'fileName',
      key: 'fileName',
      render: (value: string, record) => (
        <div className="vault-file-cell">
          <span className="vault-file-icon"><FileOutlined /></span>
          <div className="vault-file-meta">
            <Text strong ellipsis={{ tooltip: value }} className="vault-filename">
              {value}
            </Text>
            <Space size={4} wrap>
              <Text type="secondary">{formatBytes(record.size)}</Text>
              {record.origin === 'imported' && <Tag color="purple">导入</Tag>}
            </Space>
          </div>
        </div>
      ),
    },
    {
      title: '密码与哈希',
      key: 'algorithms',
      width: 190,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Tag color="blue">{record.cipherAlg}</Tag>
          <Tag color={record.hashAlg === 'SHA-1' ? 'red' : 'green'}>{record.hashAlg}</Tag>
        </Space>
      ),
    },
    {
      title: '签名状态',
      key: 'signature',
      width: 150,
      render: (_, record) => (
        <Tooltip title={`签名者 SHA-256：${record.signerFingerprint ?? '—'}`}>
          <Tag icon={<SafetyCertificateOutlined />} color="success">
            已签名
          </Tag>
          <div className="mono table-fingerprint">
            {shortFingerprint(record.signerFingerprint ?? '')}
          </div>
        </Tooltip>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (value: number) => <Text type="secondary">{formatDate(value)}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 350,
      render: (_, record) => (
        <Space size={0} wrap>
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => onDecrypt(record)}
          >
            解密
          </Button>
          <Button
            type="link"
            size="small"
            icon={<SafetyOutlined />}
            onClick={() => onVerify(record)}
          >
            验证
          </Button>
          <Button
            type="link"
            size="small"
            icon={<ExportOutlined />}
            onClick={() => onExport(record)}
          >
            导出
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => onDetails(record)}
          >
            详情
          </Button>
          <Popconfirm
            title="删除此文件？"
            description="将删除本机密文与分块；此操作不可撤销。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDelete(record)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Table<StoredFileRecord>
      rowKey="id"
      className="vault-table"
      loading={loading}
      columns={columns}
      dataSource={files}
      scroll={{ x: 900 }}
      pagination={{
        pageSize: 10,
        showSizeChanger: true,
        showTotal: (total) => `共 ${total} 个文件`,
      }}
      locale={{
        emptyText: (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="文件库为空，拖入文件开始加密"
          />
        ),
      }}
    />
  );
}
