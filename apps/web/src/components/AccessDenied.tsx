import { Link } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { Button } from './ui';

export function AccessDenied() {
  return (
    <div className="empty-state" style={{ minHeight: 420 }}>
      <div className="empty-icon"><ShieldX size={26} /></div>
      <h3>需要管理员权限</h3>
      <p>此设置仅对工作区负责人和管理员开放。</p>
      <Link to="/inbox"><Button variant="primary">返回收件箱</Button></Link>
    </div>
  );
}
