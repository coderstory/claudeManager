export type ThemeId = string;

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description?: string;
  icon: string;
  isDefault?: boolean;
  preview?: {
    accent: string;
    bg: string;
    text: string;
  };
}