export type StudioProfile = {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
};

export type StudioSheet = {
  id: number;
  title: string;
  artist: string;
  instrument: string;
  arrangement: string;
  genre: string;
  difficulty: string;
  key: string;
  bpm: number;
  tags: string[];
  description: string;
  rightsDeclaration: string;
  uploader: string;
  uploaderUsername: string | null;
  avatar: string;
  avatarUrl: string | null;
  accent: string;
  musicXml: string;
  processingMode: string;
  processingProvider: string;
  processingWarnings: string[];
  hasSourceFile: boolean;
  downloads: number;
  favorites: number;
  isFavorited?: boolean;
  isOwner?: boolean;
  createdAt: number;
  updatedAt: number;
};

export function initials(value: string): string {
  const pieces = value.trim().split(/\s+/).filter(Boolean);
  if (!pieces.length) return "S17";
  return pieces.slice(0, 2).map(piece => piece[0]?.toUpperCase()).join("");
}
