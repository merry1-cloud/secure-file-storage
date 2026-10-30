import { useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Typography,
} from 'antd';
import { KeyOutlined, SafetyCertificateOutlined, WarningOutlined } from '@ant-design/icons';
import {
  KDF_PROFILES,
  type KdfProfileId,
} from '@/core/types/crypto';
import { changeMasterPassword } from '@/core/keys/changePassword';
import { logAudit } from '@/core/audit/auditService';
import { useSessionStore } from '@/store/sessionStore';
import { errorText } from '@/lib/errors';
import { PasswordStrengthHint } from '@/components/ui/PasswordStrengthHint';

const { Text } = Typography;

export interface ChangePasswordDialogProps {
  open: boolean;
  onClose(): void;
  onChanged(): void;
}

const KDF_OPTIONS = Object.values(KDF_PROFILES).map((profile) => ({
  value: profile.id,
  label: profile.label,
}));

export function ChangePasswordDialog({
  open,
  onClose,
  onChanged,
}: ChangePasswordDialogProps): JSX.Element {
  const { message } = AntApp.useApp();
  const applySession = useSessionStore((state) => state.applySession);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [password, setPassword] = useState('');

  const submit = async (): Promise<void> => {
    setError(undefined);
    try {
      const values = await form.validateFields();
      setLoading(true);
      const result = await changeMasterPassword({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
        newKdfProfileId: values.kdfProfileId as KdfProfileId | undefined,
      });
      await applySession(result.session);
      await logAudit('password.change', 'success', {
        detail: {
          rekeyedFiles: result.rekeyedFiles,
          skippedImportedFiles: result.skippedImportedFiles,
        },
      });
      message.success(
        `主口令已更新；重包 ${result.rekeyedFiles} 个本地文件，跳过 ${result.skippedImportedFiles} 个导入容器`,
      );
      form.resetFields();
      setPassword('');
      onChanged();
      onClose();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      setError(errorText(err));
      await logAudit('password.change', 'failure');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="修改主口令 / 轮换密钥封装"
      width={640}
      onCancel={() => {
        if (loading) return;
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
          key="change"
          type="primary"
          icon={<SafetyCertificateOutlined />}
          loading={loading}
          onClick={() => void submit()}
        >
          修改主口令
        </Button>,
      ]}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="改口令会重包本地文件 DEK"
          description="旧 .sfv/外部容器仍用原口令。"
        />
        {error && <Alert type="error" showIcon message={error} />}
        <Form form={form} name="change-password-form" layout="vertical" onFinish={() => void submit()}>
          <Form.Item
            name="oldPassword"
            label="当前主口令"
            rules={[{ required: true, message: '请输入当前主口令' }]}
          >
            <Input.Password size="large" prefix={<KeyOutlined />} placeholder="当前主口令" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新主口令"
            rules={[
              { required: true, message: '请输入新主口令' },
              { min: 8, message: '至少 8 位，建议 12 位以上' },
            ]}
          >
            <Input.Password
              size="large"
              prefix={<KeyOutlined />}
              placeholder="新主口令"
              onChange={(event) => setPassword(event.target.value)}
            />
          </Form.Item>
          <PasswordStrengthHint value={password} />
          <Form.Item
            name="confirm"
            label="确认新主口令"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请确认新主口令' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入不一致'));
                },
              }),
            ]}
          >
            <Input.Password size="large" prefix={<KeyOutlined />} placeholder="再次输入" />
          </Form.Item>
          <Form.Item
            name="kdfProfileId"
            label="新 KDF 档位（可选）"
            extra="留空仅换 salt；选择后重包本地文件。"
          >
            <Select allowClear size="large" options={KDF_OPTIONS} placeholder="保持当前参数" />
          </Form.Item>
          <Text type="secondary">文件越多耗时越长；事务写入。</Text>
        </Form>
      </Space>
    </Modal>
  );
}
