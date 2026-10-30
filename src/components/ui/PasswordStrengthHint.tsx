import { Tag, Typography } from 'antd';
import { assessPassword } from '@/core/validation/passwordPolicy';

const { Text } = Typography;

export interface PasswordStrengthHintProps {
  value: string;
  minLength?: number;
}

export function PasswordStrengthHint({
  value,
  minLength = 8,
}: PasswordStrengthHintProps): JSX.Element | null {
  if (!value) return null;
  const assessment = assessPassword(value);
  const color =
    assessment.score >= 3 ? 'green' : assessment.score >= 2 ? 'gold' : 'red';
  return (
    <div className="password-meter">
      <Tag color={color}>{assessment.label}</Tag>
      <Text type="secondary">
        {value.length < minLength
          ? `至少需要 ${minLength} 个字符。`
          : assessment.message}
      </Text>
    </div>
  );
}
