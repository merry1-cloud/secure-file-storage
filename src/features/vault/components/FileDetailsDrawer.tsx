import { Descriptions, Drawer, Space, Tag, Typography } from 'antd';
import type { StoredFileRecord } from '@/core/storage/schema';
import { Fingerprint } from '@/components/ui/Fingerprint';
import { formatBytes, formatDate, kdfLabel } from '@/lib/format';

const { Text, Paragraph } = Typography;

export interface FileDetailsDrawerProps {
  file?: StoredFileRecord;
  open: boolean;
  onClose(): void;
}

function HashLine({ label, value }: { label: string; value?: string }): JSX.Element {
  return (
    <div className="hash-line">
      <Text type="secondary">{label}</Text>
      <Paragraph className="mono hash-value" copyable={{ text: value ?? '' }}>
        {value ?? '—'}
      </Paragraph>
    </div>
  );
}

export function FileDetailsDrawer({
  file,
  open,
  onClose,
}: FileDetailsDrawerProps): JSX.Element {
  const manifest = file?.manifest;
  return (
    <Drawer
      title="文件与签名清单详情"
      width={620}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      {!file || !manifest ? (
        <Text type="secondary">文件记录不完整</Text>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions
            size="small"
            column={1}
            bordered
            items={[
              { key: 'name', label: '文件名', children: manifest.filename },
              { key: 'id', label: 'File ID', children: <span className="mono">{manifest.fileId}</span> },
              { key: 'size', label: '大小', children: formatBytes(manifest.size) },
              { key: 'mime', label: 'MIME', children: manifest.mime || '—' },
              {
                key: 'origin',
                label: '来源',
                children:
                  file.origin === 'imported' ? (
                    <Tag color="purple">导入的外部容器</Tag>
                  ) : (
                    <Tag color="blue">本机加密</Tag>
                  ),
              },
              { key: 'created', label: '加密时间', children: formatDate(manifest.createdAt) },
              { key: 'signed', label: '签名时间', children: formatDate(manifest.signedAt) },
              {
                key: 'cipher',
                label: '对称算法',
                children: `${manifest.cipher.alg} · ${manifest.cipher.chunkCount} 块 × ${formatBytes(manifest.cipher.chunkSize)}`,
              },
              {
                key: 'hash',
                label: '完整性哈希',
                children: (
                  <Space>
                    <Tag color={manifest.hash.alg === 'SHA-1' ? 'red' : 'green'}>
                      {manifest.hash.alg}
                    </Tag>
                    {manifest.hash.alg === 'SHA-1' && <Text type="danger">弱碰撞算法，仅演示</Text>}
                  </Space>
                ),
              },
              { key: 'kdf', label: '密钥派生', children: kdfLabel(manifest.kdf) },
              {
                key: 'sigalg',
                label: '签名算法',
                children: manifest.signatureAlg,
              },
            ]}
          />

          <div className="details-section">
            <Text strong>内容哈希</Text>
            <HashLine label={manifest.hash.alg} value={manifest.hash.contentHash} />
          </div>

          <div className="details-section">
            <Text strong>签名者证书</Text>
            <Descriptions
              size="small"
              column={1}
              bordered
              style={{ marginTop: 8 }}
              items={[
                { key: 'subject', label: '主题', children: manifest.signer.subject },
                {
                  key: 'serial',
                  label: '序列号',
                  children: <span className="mono">{manifest.signer.serialNumber}</span>,
                },
                {
                  key: 'fingerprint',
                  label: 'SHA-256 指纹',
                  children: <Fingerprint value={manifest.signer.certSha256} />,
                },
              ]}
            />
          </div>

          <div className="details-section">
            <Text strong>密钥封装与参数</Text>
            <HashLine label="fileSalt" value={manifest.fileSalt} />
            <HashLine label="wrappedDek" value={manifest.wrappedDek} />
            <HashLine label="wrapIv" value={manifest.wrapIv} />
            <HashLine label="kcv" value={manifest.kcv} />
          </div>

          <div className="details-section">
            <Text strong>签名值</Text>
            <Paragraph className="mono hash-value">
              {file.signature
                ? Array.from(new Uint8Array(file.signature).slice(0, 48))
                    .map((byte) => byte.toString(16).padStart(2, '0'))
                    .join('')
                : '—'}
              …
            </Paragraph>
            <Text type="secondary">签名覆盖算法、KDF、密钥封装与哈希。</Text>
          </div>

          {file.origin === 'imported' && (
            <Text type="secondary">外部容器需原口令；改主口令不影响。</Text>
          )}
        </Space>
      )}
    </Drawer>
  );
}
