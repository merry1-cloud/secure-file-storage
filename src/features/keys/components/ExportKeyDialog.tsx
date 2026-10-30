import { useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Space,
} from 'antd';
import { ExportOutlined, KeyOutlined, WarningOutlined } from '@ant-design/icons';
import { createPrivateKeyExport } from '@/core/keys/exportKey';
import { logAudit } from '@/core/audit/auditService';
import { downloadJson } from '@/lib/download';
import { errorText } from '@/lib/errors';
import { PasswordStrengthHint } from '@/components/ui/PasswordStrengthHint';

export interface ExportKeyDialogProps {
  open: boolean;
  onClose(): void;
}

export function ExportKeyDialog({ open, onClose }: ExportKeyDialogProps): JSX.Element {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [passphrase, setPassphrase] = useState('');

  const submit = async (): Promise<void> => {
    setError(undefined);
    try {
      const values = await form.validateFields();
      setLoading(true);
      const bundle = await createPrivateKeyExport({
        masterPassword: values.masterPassword,
        exportPassphrase: values.exportPassphrase,
      });
      const date = new Date().toISOString().slice(0, 10);
      downloadJson(bundle, `secure-vault-private-${date}.sfkey`);
      await logAudit('key.export', 'success');
      message.success('私钥已加密导出（.sfkey）');
      form.resetFields();
      setPassphrase('');
      onClose();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      setError(errorText(err));
      await logAudit('key.export', 'failure');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="导出 RSA 私钥"
      width={620}
      onCancel={() => {
        if (loading) return;
        form.resetFields();
        setPassphrase('');
        setError(undefined);
        onClose();
      }}
      closable={!loading}
      maskClosable={false}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose} disabled={loading}>
          取消
        </Button>,
        <Button
          key="export"
          type="primary"
          danger
          icon={<ExportOutlined />}
          loading={loading}
          onClick={() => void submit()}
        >
          加密导出私钥
        </Button>,
      ]}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="导出文件可离线破解"
          description="请用独立强口令并离线保存。"
        />
        {error && <Alert type="error" showIcon message={error} />}
        <Form form={form} name="export-key-form" layout="vertical" onFinish={() => void submit()}>
          <Form.Item
            name="masterPassword"
            label="当前保管库主口令（重新验证）"
            rules={[{ required: true, message: '请输入主口令' }]}
          >
            <Input.Password size="large" prefix={<KeyOutlined />} placeholder="主口令" />
          </Form.Item>
          <Form.Item
            name="exportPassphrase"
            label="导出口令（独立于主口令，至少 12 位）"
            rules={[
              { required: true, message: '请设置导出口令' },
              { min: 12, message: '导出口令至少 12 位' },
            ]}
          >
            <Input.Password
              size="large"
              prefix={<KeyOutlined />}
              placeholder="导出口令"
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </Form.Item>
          <PasswordStrengthHint value={passphrase} minLength={12} />
          <Form.Item
            name="confirm"
            label="确认导出口令"
            dependencies={['exportPassphrase']}
            rules={[
              { required: true, message: '请确认导出口令' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('exportPassphrase') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入不一致'));
                },
              }),
            ]}
          >
            <Input.Password size="large" prefix={<KeyOutlined />} placeholder="再次输入" />
          </Form.Item>
        </Form>
      </Space>
    </Modal>
  );
}
