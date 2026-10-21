// Secondary UI safeguard. The Flask API remains the source of truth.
// Guests and users without a recorded adult age NEVER get 18+ products.
const clothing = /\b(?:tangas?|tangas?\s+set|thongs?|panties|knickers|underwear|underpants|briefs|boxers|lingerie|bras?|bralettes?|swimwear|swimsuits?|bikinis?|jeans|pants?|shorts|trousers|leggings|dresses|skirts|blouses|tank\s+tops?|shirts?|t-shirts?|hoodies?|sweatshirts?|sweaters?|cardigans?|jerseys?|jackets?|coats?|jumpsuits?|sleepwear|pyjamas?|pajamas?|socks?|stockings|sandals?|slippers?|trainers?|sneakers?|footwear|shoes?|boots?|rompers?|onesies?|tights?|clothing|apparel|menswear|womenswear|kidswear|babywear|activewear|fashion|handbags?|scarves?|beanies?|caps?\s+for\s+(?:men|women)|school\s+uniforms?|shoe\s+laces)\b/i;
const alcohol = /\b(?:alcohol(?:ic)?|liquor|spirits?|beer|lager|cider|whisk(?:e)?y|vodka|gin|brandy|rum|tequila|wines?|champagne|prosecco|liqueur|savann?ah?|hunters\s+(?:dry|gold|extreme)|castle\s+(?:lite|lager|double\s+malt)|carling\s+black\s+label|heineken|windhoek|amstel|hansa|flying\s+fish|smirnoff|klipdrift|jagermeister|jack\s+daniel'?s|johnnie\s+walker|strongbow|stella\s+artois|corona\s+extra|belgravia|bacardi|brutal\s+fruit|nederburg|tassies|4th\s+street)\b/i;
const tobacco = /\b(?:tobacco|cigarettes?|cigars?|nicotine|vapes?|e-cigarettes?|snuff|shisha)\b/i;
const foodExceptions = /\b(?:wine\s+(?:gums?|vinegar)|beer\s+(?:battered|bread)|non[- ]?alcoholic|alcohol[- ]?free|zero\s+alcohol)\b/gi;
const restrictedCats = new Set(['liquor', 'alcohol', 'tobacco', 'age restricted', 'adult', '18+']);

export function canViewAdultProducts(user) {
  return Boolean(user && (user.is_admin === true || user.isAdmin === true || user.age_group === 'adult'));
}

export function isClothingProduct(product) {
  const name = String(product?.name || '');
  const category = `${product?.catalogCategory || ''} ${product?.category || ''}`;
  const householdGloves = /\b(?:cleaning|dishwashing|rubber|latex|nitrile|examination|gardening|work)\s+gloves?\b/i.test(name);
  return (!householdGloves && clothing.test(name)) || /\b(?:clothing|apparel|fashion|lingerie|underwear|swimwear|footwear|menswear|womenswear)\b/i.test(category);
}

export function isAdultProduct(product) {
  if (product?.ageRestricted === true || product?.age_restricted === true || Number(product?.minimumAge || 0) >= 18) return true;
  const categories = [product?.catalogCategory, product?.category].map((x) => String(x || '').toLowerCase());
  if (categories.some((x) => restrictedCats.has(x))) return true;
  const originalName = String(product?.name || '');
  const nonAlcoholic = /\b(?:non[- ]?alcoholic|alcohol[- ]?free|zero\s+alcohol)\b/i.test(originalName);
  const name = originalName.replace(foodExceptions, ' ');
  return (!nonAlcoholic && alcohol.test(name)) || tobacco.test(name) || /(?:^|\W)18\+(?:$|\W)|\badult\s+(?:toy|content)\b/i.test(name);
}

export function isVisibleProduct(product, user) {
  return product && !isClothingProduct(product) && (canViewAdultProducts(user) || !isAdultProduct(product));
}