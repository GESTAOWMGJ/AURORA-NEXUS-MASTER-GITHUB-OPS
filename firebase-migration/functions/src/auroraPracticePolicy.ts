/** Personalité administrative roles never inherit generic or clinical permissions. */
export const PRACTICE_ROLES = ['practice_owner', 'practice_reception', 'practice_finance', 'practice_editor'] as const;
export function isPracticeRole(role: string): boolean { return (PRACTICE_ROLES as readonly string[]).includes(role); }
export function practiceAreas(role: string): string[] {
  switch (role) {
    case 'practice_owner': return ['Governança', 'Equipe'];
    case 'practice_reception': return ['Recepção'];
    case 'practice_finance': return ['Financeiro'];
    case 'practice_editor': return ['Conteúdo institucional'];
    default: return [];
  }
}
