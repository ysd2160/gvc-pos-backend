// Converts a rupee amount into words using the Indian numbering system
// (thousand / lakh / crore), matching how printed tax invoices phrase the
// total — e.g. 856 -> "Eight Hundred and Fifty Six Rupees only".
// Paise (decimal part) are included as "and NN Paise" when present.

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

// Converts a 0-999 integer into words
const threeDigitsToWords = (num) => {
  let str = "";
  if (num >= 100) {
    str += `${ONES[Math.floor(num / 100)]} Hundred`;
    num %= 100;
    if (num > 0) str += " and ";
  }
  if (num >= 20) {
    str += TENS[Math.floor(num / 10)];
    if (num % 10 > 0) str += ` ${ONES[num % 10]}`;
  } else if (num > 0) {
    str += ONES[num];
  }
  return str.trim();
};

const integerToWords = (num) => {
  if (num === 0) return "Zero";

  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  const rest = num;

  const parts = [];
  if (crore > 0) parts.push(`${threeDigitsToWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${threeDigitsToWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${threeDigitsToWords(thousand)} Thousand`);
  if (rest > 0) parts.push(threeDigitsToWords(rest));

  return parts.join(" ");
};

// amountToWords(856) -> "Eight Hundred and Fifty Six Rupees only"
// amountToWords(856.50) -> "Eight Hundred and Fifty Six Rupees and Fifty Paise only"
export const amountToWords = (amount) => {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);

  let words = `${integerToWords(rupees)} Rupees`;
  if (paise > 0) {
    words += ` and ${integerToWords(paise)} Paise`;
  }
  return `${words} only`;
};
