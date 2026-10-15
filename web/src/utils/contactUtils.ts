import type { Contact } from '../api';

export interface FormattedContactInfo {
  title: string;
  subtitle?: string;
  formattedPhone?: string;
}

export function formatPhoneNumber(rawNumber: string): string {
  const digits = rawNumber.replace(/\D/g, '');
  // Telefone brasileiro: 55 + DDD (2 dígitos) + 8 ou 9 dígitos
  if (/^55\d{10,11}$/.test(digits)) {
    const ddd = digits.substring(2, 4);
    const rest = digits.substring(4);
    if (rest.length === 9) {
      return `+55 (${ddd}) ${rest.substring(0, 5)}-${rest.substring(5)}`;
    }
    return `+55 (${ddd}) ${rest.substring(0, 4)}-${rest.substring(4)}`;
  }

  // Telefone internacional padrão
  if (/^\d{8,15}$/.test(digits) && !rawNumber.includes('-')) {
    return `+${digits}`;
  }

  return rawNumber;
}

export function getContactDisplay(contact: Contact): FormattedContactInfo {
  const rawId = contact.jid.split('@')[0];
  const isPurePhone = /^\d{8,15}$/.test(rawId) && !rawId.includes('-');
  const formattedPhone = isPurePhone ? formatPhoneNumber(rawId) : undefined;

  // Se for grupo
  if (Boolean(contact.is_group)) {
    return {
      title: contact.name || contact.notify_name || 'Grupo sem nome',
      subtitle: undefined,
      formattedPhone: undefined
    };
  }

  // Se tiver nome salvo na agenda
  if (contact.name && contact.name.trim().length > 0) {
    return {
      title: contact.name,
      subtitle: formattedPhone || contact.notify_name || undefined,
      formattedPhone
    };
  }

  // Se tiver notify_name do WhatsApp
  if (contact.notify_name && contact.notify_name.trim().length > 0) {
    return {
      title: contact.notify_name,
      subtitle: formattedPhone || undefined,
      formattedPhone
    };
  }

  // Se não tiver nenhum nome, o título principal é o telefone formatado
  return {
    title: formattedPhone || 'Contato sem nome',
    subtitle: undefined,
    formattedPhone
  };
}
