export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value || 0));
}

export function formatCompact(value: number): string {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 100_000_000) {
    return `${(number / 100_000_000).toFixed(1).replace(/\.0$/, '')}亿`;
  }
  if (Math.abs(number) >= 10_000) {
    return `${(number / 10_000).toFixed(1).replace(/\.0$/, '')}万`;
  }
  if (Math.abs(number) >= 1_000) {
    return `${(number / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return formatNumber(number);
}

export function formatDate(value: string | Date): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatDateTime(value: string | Date): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatTime(value: string | Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function relativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDate(value);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function initials(name: string): string {
  if (!name) return '?';
  const clean = name.trim();
  if (/[\u3400-\u9fff]/.test(clean)) return clean.slice(-2);
  return clean
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function percentChange(value: number): {
  positive: boolean;
  label: string;
} {
  return {
    positive: value >= 0,
    label: `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`,
  };
}

export function roleLabel(role: string): string {
  return role === 'OWNER'
    ? '负责人'
    : role === 'ADMIN'
      ? '管理员'
      : role === 'AGENT'
        ? '客服'
        : role === 'CUSTOMER'
          ? '客户'
          : role;
}

export function priorityLabel(priority: string): string {
  return (
    { urgent: '紧急', high: '高', normal: '普通', low: '低' }[priority] ??
    priority
  );
}

export function categoryLabel(category: string): string {
  return (
    {
      billing: '账单',
      refund: '退款',
      technical: '技术',
      account: '账号',
      feature: '需求',
      other: '其他',
    }[category] ?? category
  );
}

export function slaStatusLabel(status: string): string {
  return (
    {
      met: '已达成',
      on_track: '正常',
      at_risk: '即将超时',
      breached: '已超时',
      not_started: '未开始',
    }[status] ?? status
  );
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 0) return `超时 ${Math.abs(Math.round(minutes))} 分`;
  if (minutes < 60) return `${Math.round(minutes)} 分`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} 小时`;
  return `${(minutes / 1440).toFixed(1)} 天`;
}

export function statusLabelForPortal(status: string): string {
  return (
    {
      new: '已提交',
      triaged: '处理中',
      ai_drafted: '客服审核中',
      waiting_customer: '等待你的回复',
      escalated: '已升级处理',
      resolved: '已解决',
      closed: '已关闭',
    }[status] ?? status
  );
}


export function sourceLabel(source: string): string {
  return source === 'playground' ? '调试台' : '对话';
}

export function todayLabel(): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
        .join(','),
    )
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
