import { useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Progress,
  Row,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  DashboardOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { BenchmarkResult } from '@/core/storage/schema';
import type {
  BenchmarkEnvironment,
  BenchmarkJobResult,
} from '@/workers/protocol';
import { startBenchmarkJob } from '@/workers/workerClient';
import { saveBenchmark } from '@/core/storage/repositories/benchmarkRepo';
import { logAudit } from '@/core/audit/auditService';
import { randomUuid } from '@/core/crypto/random';
import { downloadText } from '@/lib/download';
import { errorCode, errorText } from '@/lib/errors';
import { formatBytes, formatDuration } from '@/lib/format';

const { Text, Title, Paragraph } = Typography;

const SIZE_OPTIONS = [
  { value: 1, label: '1 MB' },
  { value: 10, label: '10 MB' },
  { value: 100, label: '100 MB' },
];

export function BenchmarkPage(): JSX.Element {
  const { message } = AntApp.useApp();
  const [sizes, setSizes] = useState<number[]>([1, 10, 100]);
  const [includeScrypt, setIncludeScrypt] = useState(true);
  const [includeEndToEnd, setIncludeEndToEnd] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; percent: number }>();
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [environment, setEnvironment] = useState<BenchmarkEnvironment>();
  const [error, setError] = useState<string>();
  const handleRef = useRef<ReturnType<typeof startBenchmarkJob> | null>(null);

  const run = async (): Promise<void> => {
    setError(undefined);
    setResults([]);
    setEnvironment(undefined);
    if (sizes.length === 0) {
      setError('至少选择一个文件大小');
      return;
    }
    setRunning(true);
    setProgress({ stage: '准备数据', percent: 0 });
    try {
      const handle = startBenchmarkJob(
        {
          sizesBytes: sizes.map((size) => size * 1024 * 1024),
          includeScrypt,
          includeEndToEnd,
        },
        ({ stage, done, total }) => {
          setProgress({
            stage,
            percent: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0,
          });
        },
      );
      handleRef.current = handle;
      const result: BenchmarkJobResult = await handle.promise;
      setResults(result.results);
      setEnvironment(result.environment);
      const env = {
        userAgent: result.environment.userAgent,
        hardwareConcurrency: result.environment.hardwareConcurrency,
        deviceMemoryGb: result.environment.deviceMemoryGb ?? 0,
        crossOriginIsolated: result.environment.crossOriginIsolated ?? false,
      };
      try {
        await saveBenchmark({
          id: randomUuid(),
          createdAt: Date.now(),
          environment: env,
          results: result.results,
        });
      } catch (saveError) {
        message.warning(`性能结果保存失败：${errorText(saveError)}`);
      }
      await logAudit('benchmark.run', 'success', {
        detail: {
          sizes: sizes.join(','),
          includeScrypt,
          includeEndToEnd,
          resultCount: result.results.length,
        },
      });
      setProgress({ stage: '完成', percent: 100 });
      message.success('性能测试完成');
    } catch (err) {
      if (errorCode(err) === 'E_CANCELLED') {
        setError('性能测试已取消');
      } else {
        setError(errorText(err));
      }
      await logAudit('benchmark.run', 'failure', {
        errorCode: errorCode(err),
      });
    } finally {
      handleRef.current = null;
      setRunning(false);
    }
  };

  const cancel = (): void => {
    handleRef.current?.cancel();
  };

  const columns: ColumnsType<BenchmarkResult> = [
    {
      title: '项目',
      dataIndex: 'name',
      key: 'name',
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '文件大小',
      dataIndex: 'sizeBytes',
      key: 'sizeBytes',
      width: 110,
      render: (value?: number) => (value ? formatBytes(value) : '—'),
    },
    {
      title: '中位耗时',
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 120,
      align: 'right',
      render: (value: number) => (
        <span className="mono">{value > 0 ? formatDuration(value) : '—'}</span>
      ),
    },
    {
      title: '吞吐',
      dataIndex: 'throughputMBps',
      key: 'throughputMBps',
      width: 120,
      align: 'right',
      render: (value?: number) =>
        value ? <span className="mono">{value.toFixed(1)} MiB/s</span> : '—',
    },
    {
      title: '迭代',
      dataIndex: 'iterations',
      key: 'iterations',
      width: 80,
      align: 'right',
      render: (value?: number) => (value ?? '—'),
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      render: (value?: string) => value ?? '—',
    },
  ];

  const exportMarkdown = (): void => {
    const lines: string[] = [];
    lines.push('# 安全文件存储系统性能测试');
    lines.push('');
    lines.push(`- 时间：${new Date().toLocaleString('zh-CN')}`);
    if (environment) {
      lines.push(`- 环境：${environment.userAgent}`);
      lines.push(
        `- 逻辑核心：${environment.hardwareConcurrency} · 设备内存：${environment.deviceMemoryGb ?? '未知'} GiB · crossOriginIsolated：${environment.crossOriginIsolated ?? false}`,
      );
    }
    lines.push('');
    lines.push('| 项目 | 文件大小 | 中位耗时 | 吞吐 | 迭代 | 备注 |');
    lines.push('| --- | ---: | ---: | ---: | ---: | --- |');
    for (const row of results) {
      lines.push(
        `| ${row.name} | ${row.sizeBytes ? formatBytes(row.sizeBytes) : '—'} | ${row.durationMs > 0 ? formatDuration(row.durationMs) : '—'} | ${row.throughputMBps ? `${row.throughputMBps.toFixed(1)} MiB/s` : '—'} | ${row.iterations ?? '—'} | ${(row.note ?? '').replace(/\|/g, '\\|')} |`,
      );
    }
    downloadText(lines.join('\n'), `benchmark-${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown;charset=utf-8');
  };

  const exportCsv = (): void => {
    const escape = (value: unknown): string =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['name', 'sizeBytes', 'durationMs', 'throughputMBps', 'iterations', 'note']
        .map(escape)
        .join(','),
      ...results.map((row) =>
        [
          row.name,
          row.sizeBytes ?? '',
          row.durationMs,
          row.throughputMBps ?? '',
          row.iterations ?? '',
          row.note ?? '',
        ]
          .map(escape)
          .join(','),
      ),
    ];
    downloadText(
      lines.join('\n'),
      `benchmark-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8',
    );
  };

  return (
    <div className="page-stack">
      <Alert
        type="warning"
        showIcon
        icon={<DashboardOutlined />}
        message="性能测试可能占用较多资源"
        description="100 MB/scrypt 可能耗时数十秒；可取消。"
      />

      <Card className="benchmark-card" bordered={false}>
        <div className="section-heading">
          <div>
            <Title level={4}>测试参数</Title>
            <Text type="secondary">结果取多次运行中位数，可直接导出到报告</Text>
          </div>
          <Space wrap>
            <Checkbox.Group
              value={sizes}
              onChange={(values) => setSizes(values as number[])}
              options={SIZE_OPTIONS}
              disabled={running}
            />
            <Checkbox
              checked={includeScrypt}
              disabled={running}
              onChange={(event) => setIncludeScrypt(event.target.checked)}
            >
              scrypt
            </Checkbox>
            <Checkbox
              checked={includeEndToEnd}
              disabled={running}
              onChange={(event) => setIncludeEndToEnd(event.target.checked)}
            >
              端到端加密/解密
            </Checkbox>
          </Space>
        </div>
        <Space wrap>
          <Button
            type="primary"
            size="large"
            icon={<PlayCircleOutlined />}
            loading={running}
            onClick={() => void run()}
          >
            开始性能测试
          </Button>
          {running && (
            <Button danger size="large" icon={<StopOutlined />} onClick={cancel}>
              取消
            </Button>
          )}
          <Button
            size="large"
            icon={<DownloadOutlined />}
            disabled={results.length === 0}
            onClick={exportMarkdown}
          >
            导出 Markdown
          </Button>
          <Button
            size="large"
            icon={<DownloadOutlined />}
            disabled={results.length === 0}
            onClick={exportCsv}
          >
            导出 CSV
          </Button>
        </Space>
        {progress && running && (
          <div className="benchmark-progress">
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Text>{progress.stage}</Text>
              <Text type="secondary">{progress.percent}%</Text>
            </Space>
            <Progress percent={progress.percent} status="active" />
          </div>
        )}
        {error && <Alert type="error" showIcon message={error} style={{ marginTop: 16 }} />}
      </Card>

      {environment && (
        <Card className="benchmark-card" bordered={false} title="测试环境">
          <Descriptions
            size="small"
            column={{ xs: 1, md: 2 }}
            items={[
              {
                key: 'ua',
                label: 'User Agent',
                children: <span className="mono small-mono">{environment.userAgent}</span>,
              },
              {
                key: 'cores',
                label: '逻辑核心',
                children: environment.hardwareConcurrency || '未知',
              },
              {
                key: 'memory',
                label: '设备内存',
                children: environment.deviceMemoryGb
                  ? `${environment.deviceMemoryGb} GiB`
                  : '浏览器未提供',
              },
              {
                key: 'isolated',
                label: 'Cross-Origin Isolated',
                children: environment.crossOriginIsolated ? '是' : '否',
              },
            ]}
          />
        </Card>
      )}

      {results.length > 0 && (
        <Card
          className="benchmark-card"
          bordered={false}
          title={
            <Space>
              <DashboardOutlined />
              <span>测试结果</span>
              <Tag>{results.length} 项</Tag>
            </Space>
          }
        >
          <Table
            rowKey={(record, index) => `${record.name}-${index}`}
            size="small"
            pagination={false}
            scroll={{ x: 900 }}
            dataSource={results}
            columns={columns}
          />
          <Paragraph type="secondary" className="small-paragraph" style={{ marginTop: 12 }}>
            端到端含读取、分块、哈希与签名，不含下载。
          </Paragraph>
        </Card>
      )}
    </div>
  );
}
