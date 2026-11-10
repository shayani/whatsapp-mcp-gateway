import type { Translate } from '../i18n';
import type { Contact } from '../api';

export interface FormattedContactInfo {
  title: string;
  subtitle?: string;
  formattedPhone?: string;
  isNewsletter?: boolean;
}

export function formatPhoneNumber(rawNumber: string): string {
  const digits = rawNumber.replace(/\D/g, '');

  // 0800 brasileiro (55 + 800 + 7 dígitos ou 0800 + 7 dígitos)
  if (/^55(800)(\d{3})(\d{4})$/.test(digits)) {
    return digits.replace(/^55(800)(\d{3})(\d{4})$/, '+55 ($1) $2-$3');
  }
  if (/^(0800)(\d{3})(\d{4})$/.test(digits)) {
    return digits.replace(/^(0800)(\d{3})(\d{4})$/, '$1 $2-$3');
  }

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

export function getContactDisplay(contact: Contact, t: Translate): FormattedContactInfo {
  const isNewsletter = contact.jid.endsWith('@newsletter');
  const isLid = contact.jid.endsWith('@lid');
  const rawId = contact.jid.split('@')[0];
  const linkedPhoneRaw = contact.linked_phone ? contact.linked_phone.split('@')[0] : undefined;

  const isPurePhone = !isLid && !isNewsletter && /^\d{8,15}$/.test(rawId) && !rawId.includes('-');
  const formattedPhone = isPurePhone
    ? formatPhoneNumber(rawId)
    : (linkedPhoneRaw && /^\d{8,15}$/.test(linkedPhoneRaw) && !linkedPhoneRaw.includes('-')
      ? formatPhoneNumber(linkedPhoneRaw)
      : undefined);

  // Se for canal / newsletter
  if (isNewsletter) {
    return {
      title: contact.name || contact.notify_name || t("Unnamed channel"),
      subtitle: undefined,
      formattedPhone: undefined,
      isNewsletter: true
    };
  }

  // Se for grupo
  if (Boolean(contact.is_group)) {
    return {
      title: contact.name || contact.notify_name || t("Unnamed group"),
      subtitle: undefined,
      formattedPhone: undefined
    };
  }

  // Se tiver nome salvo na agenda
  if (contact.name && contact.name.trim().length > 0) {
    return {
      title: contact.name,
      subtitle: formattedPhone || (contact.notify_name && contact.notify_name !== contact.name ? contact.notify_name : undefined),
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

  // Se não tiver nenhum nome, o título principal é o telefone formatado (direto ou via linked_phone)
  return {
    title: formattedPhone || (isLid ? t("Unnamed contact") : formatPhoneNumber(rawId)),
    subtitle: undefined,
    formattedPhone
  };
}
