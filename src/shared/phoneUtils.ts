export interface CountryCodeOption {
  iso: string;
  name: string;
  dial: string;
  flag: string;
  pinned?: boolean;
}

export const COUNTRY_CODES: CountryCodeOption[] = [
  // Países fijados en el top según flujo operativo
  { iso: 'US', name: 'Estados Unidos', dial: '1', flag: '🇺🇸', pinned: true },
  { iso: 'ES', name: 'España', dial: '34', flag: '🇪🇸', pinned: true },
  { iso: 'EC', name: 'Ecuador', dial: '593', flag: '🇪🇨', pinned: true },
  // Resto de países frecuentes
  { iso: 'CO', name: 'Colombia', dial: '57', flag: '🇨🇴' },
  { iso: 'MX', name: 'México', dial: '52', flag: '🇲🇽' },
  { iso: 'PE', name: 'Perú', dial: '51', flag: '🇵🇪' },
  { iso: 'CL', name: 'Chile', dial: '56', flag: '🇨🇱' },
  { iso: 'AR', name: 'Argentina', dial: '54', flag: '🇦🇷' },
  { iso: 'VE', name: 'Venezuela', dial: '58', flag: '🇻🇪' },
  { iso: 'BO', name: 'Bolivia', dial: '591', flag: '🇧🇴' },
  { iso: 'PY', name: 'Paraguay', dial: '595', flag: '🇵🇾' },
  { iso: 'UY', name: 'Uruguay', dial: '598', flag: '🇺🇾' },
  { iso: 'BR', name: 'Brasil', dial: '55', flag: '🇧🇷' },
  { iso: 'PA', name: 'Panamá', dial: '507', flag: '🇵🇦' },
  { iso: 'CR', name: 'Costa Rica', dial: '506', flag: '🇨🇷' },
  { iso: 'GT', name: 'Guatemala', dial: '502', flag: '🇬🇹' },
  { iso: 'HN', name: 'Honduras', dial: '504', flag: '🇭🇳' },
  { iso: 'SV', name: 'El Salvador', dial: '503', flag: '🇸🇻' },
  { iso: 'NI', name: 'Nicaragua', dial: '505', flag: '🇳🇮' },
  { iso: 'DO', name: 'Rep. Dominicana', dial: '1809', flag: '🇩🇴' },
  { iso: 'PR', name: 'Puerto Rico', dial: '1787', flag: '🇵🇷' },
  { iso: 'CA', name: 'Canadá', dial: '1', flag: '🇨🇦' },
  { iso: 'GB', name: 'Reino Unido', dial: '44', flag: '🇬🇧' },
  { iso: 'FR', name: 'Francia', dial: '33', flag: '🇫🇷' },
  { iso: 'DE', name: 'Alemania', dial: '49', flag: '🇩🇪' },
  { iso: 'IT', name: 'Italia', dial: '39', flag: '🇮🇹' },
  { iso: 'PT', name: 'Portugal', dial: '351', flag: '🇵🇹' },
  { iso: 'CH', name: 'Suiza', dial: '41', flag: '🇨🇭' }
];

const DIAL_MATCH_ORDER = [...COUNTRY_CODES].sort((a, b) => b.dial.length - a.dial.length);

export function getCountryByDial(dial: string): CountryCodeOption {
  const clean = (dial || '').replace(/\D/g, '');
  return COUNTRY_CODES.find((c) => c.dial === clean) || {
    iso: 'GL',
    name: `Código +${clean || '?'}`,
    dial: clean,
    flag: '🌐'
  };
}

export function detectCountryFromDigits(digits: string): string {
  for (const entry of DIAL_MATCH_ORDER) {
    if (digits.startsWith(entry.dial) && digits.length >= entry.dial.length + 7) {
      return entry.dial;
    }
  }
  return '';
}

export interface DetectedPhone {
  phone: string; // Formato +digits
  digits: string; // Solo dígitos con código de país
  countryDial: string;
  localNumber: string;
}

export function detectAndFormatPhone(raw: string): DetectedPhone | null {
  const trimmed = (raw || '').trim();
  const hasPlus = trimmed.startsWith('+');
  let clean = trimmed.replace(/\D/g, '');
  if (clean.startsWith('00') && clean.length > 9) {
    clean = clean.substring(2);
  }
  if (clean.length < 7 || clean.length > 15) return null;

  // 1. Si trae '+' explícito, respetar o detectar prefijo internacional
  if (hasPlus) {
    const matchedDial = detectCountryFromDigits(clean) || (clean.startsWith('1') ? '1' : '');
    const localNumber = matchedDial ? clean.slice(matchedDial.length) : clean;
    return {
      phone: `+${clean}`,
      digits: clean,
      countryDial: matchedDial,
      localNumber
    };
  }

  // 2. Ecuador: 09xxxxxxxx (10 dígitos) o 9xxxxxxxx (9 dígitos) o 5939xxxxxxxx (12 dígitos)
  if (clean.startsWith('09') && clean.length === 10) {
    const localNumber = clean.substring(1);
    const digits = `593${localNumber}`;
    return { phone: `+${digits}`, digits, countryDial: '593', localNumber };
  }
  if (clean.startsWith('9') && clean.length === 9) {
    const digits = `593${clean}`;
    return { phone: `+${digits}`, digits, countryDial: '593', localNumber: clean };
  }
  if (clean.startsWith('593') && clean.length >= 11 && clean.length <= 12) {
    return {
      phone: `+${clean}`,
      digits: clean,
      countryDial: '593',
      localNumber: clean.slice(3)
    };
  }

  // 3. España: móviles 6xxxxxxxx / 7xxxxxxxx (9 dígitos) o 346xxxxxxxx / 347xxxxxxxx (11 dígitos)
  if ((clean.startsWith('6') || clean.startsWith('7')) && clean.length === 9) {
    const digits = `34${clean}`;
    return { phone: `+${digits}`, digits, countryDial: '34', localNumber: clean };
  }
  if (clean.startsWith('34') && clean.length === 11) {
    return {
      phone: `+${clean}`,
      digits: clean,
      countryDial: '34',
      localNumber: clean.slice(2)
    };
  }

  // 4. USA / Canadá: 1 + 10 dígitos (11 dígitos) o 10 dígitos sin 0 inicial
  if (clean.startsWith('1') && clean.length === 11) {
    return {
      phone: `+${clean}`,
      digits: clean,
      countryDial: '1',
      localNumber: clean.slice(1)
    };
  }
  if (clean.length === 10 && !clean.startsWith('0')) {
    const digits = `1${clean}`;
    return { phone: `+${digits}`, digits, countryDial: '1', localNumber: clean };
  }

  // 5. Prefijo internacional conocido sin '+'
  const matched = detectCountryFromDigits(clean);
  if (matched) {
    return {
      phone: `+${clean}`,
      digits: clean,
      countryDial: matched,
      localNumber: clean.slice(matched.length)
    };
  }

  // 6. Fallback local con 0 inicial -> Ecuador (+593)
  if (clean.startsWith('0') && clean.length >= 9 && clean.length <= 10) {
    const localNumber = clean.substring(1);
    const digits = `593${localNumber}`;
    return { phone: `+${digits}`, digits, countryDial: '593', localNumber };
  }

  return {
    phone: `+${clean}`,
    digits: clean,
    countryDial: '',
    localNumber: clean
  };
}

export function replacePhoneCountryCode(
  currentPhone: string,
  currentCountryDial: string,
  newCountryDial: string,
  storedLocalNumber?: string
): DetectedPhone {
  const newDial = newCountryDial.replace(/\D/g, '');
  let local = (storedLocalNumber || '').replace(/\D/g, '');

  if (!local) {
    const currentDigits = (currentPhone || '').replace(/\D/g, '');
    const curDial = (currentCountryDial || '').replace(/\D/g, '') || detectCountryFromDigits(currentDigits);
    local = curDial && currentDigits.startsWith(curDial)
      ? currentDigits.slice(curDial.length)
      : currentDigits;
  }

  // Si tenía 0 inicial nacional al cambiar a otro país, quitarlo
  if (local.startsWith('0') && local.length >= 9) {
    local = local.substring(1);
  }

  const digits = `${newDial}${local}`;
  return {
    phone: `+${digits}`,
    digits,
    countryDial: newDial,
    localNumber: local
  };
}

export function normalizePhoneDigits(raw: string): string | null {
  const detected = detectAndFormatPhone(raw);
  return detected ? detected.digits : null;
}
