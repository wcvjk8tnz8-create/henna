/** 类名合并：clsx 拼条件类，tailwind-merge 去掉互相冲突的 Tailwind 类（如 px-2 px-4 → px-4） */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(...inputs));
}
