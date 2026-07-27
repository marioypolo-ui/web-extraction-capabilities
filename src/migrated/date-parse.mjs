import { todayShanghai } from './time.mjs';

function pad(value) {
  return String(value).padStart(2, '0');
}

function normalizeDigits(value) {
  return String(value).replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xff10 + 48));
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function formatDate(year, month, day) {
  if (!validDate(year, month, day)) {
    return '';
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parsePublicationDate(text, now = new Date()) {
  const normalized = normalizeDigits(text).replace(/\s+/g, ' ');

  const fullDate = /((?:19|20)\d{2})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*(?:日)?/.exec(normalized);
  if (fullDate) {
    return formatDate(Number(fullDate[1]), Number(fullDate[2]), Number(fullDate[3]));
  }

  const compactDate = /((?:19|20)\d{2})(\d{2})(\d{2})/.exec(normalized);
  if (compactDate) {
    return formatDate(Number(compactDate[1]), Number(compactDate[2]), Number(compactDate[3]));
  }

  const monthDay = /(?:^|[^\d])(\d{1,2})\s*(?:月|[-/])\s*(\d{1,2})\s*(?:日)?(?:[^\d]|$)/.exec(normalized);
  if (!monthDay) {
    return '';
  }

  const [yearText] = todayShanghai(now).split('-');
  let year = Number(yearText);
  const month = Number(monthDay[1]);
  const day = Number(monthDay[2]);
  let inferred = formatDate(year, month, day);
  if (!inferred) {
    return '';
  }

  const today = todayShanghai(now);
  if (inferred > today) {
    year -= 1;
    inferred = formatDate(year, month, day);
  }

  return inferred;
}

const PUBLICATION_CONTEXT = /(?:发布(?:时间|日期)?|发表时间|公告日期|公示时间|信息发布时间)/;
const NON_PUBLICATION_CONTEXT = /(?:截止|开标|报名|递交|响应|投标|提交|开启)/;
const DATE_PATTERN =
  /((?:19|20)\d{2}\s*(?:年|[-/.])\s*\d{1,2}\s*(?:月|[-/.])\s*\d{1,2}\s*(?:日)?|(?:19|20)\d{6}|(?:^|[^\d])\d{1,2}\s*(?:月|[-/])\s*\d{1,2}\s*(?:日)?(?:[^\d]|$))/;

export function parseLikelyPublicationDate(text, now = new Date()) {
  const normalized = normalizeDigits(text).replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  const publicationMatch = PUBLICATION_CONTEXT.exec(normalized);
  if (publicationMatch) {
    return parsePublicationDate(normalized.slice(publicationMatch.index, publicationMatch.index + 120), now);
  }

  const dateMatch = DATE_PATTERN.exec(normalized);
  if (!dateMatch) {
    return '';
  }

  const contextBeforeDate = normalized.slice(Math.max(0, dateMatch.index - 24), dateMatch.index);
  if (NON_PUBLICATION_CONTEXT.test(contextBeforeDate)) {
    return '';
  }

  return parsePublicationDate(normalized, now);
}
