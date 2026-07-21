export const money = (value, currency = "USD") => new Intl.NumberFormat(undefined, {
  style: "currency",
  currency,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0));

export const whole = (value) => new Intl.NumberFormat().format(Math.round(Number(value || 0)));
export const decimal = (value, digits = 1) => new Intl.NumberFormat(undefined, {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
}).format(Number(value || 0));
export const percent = (value) => `${decimal(value, 1)}%`;

const key = (value) => String(value || "").trim().toLocaleLowerCase();
const quantity = (value) => Math.max(0, Number.parseInt(value || 0, 10) || 0);
const number = (value) => Math.max(0, Number(value || 0) || 0);

export function calculateLegacyEstimate(inventory, primary, config) {
  const current = new Map(inventory.map((item) => [key(item.name), quantity(item.quantity)]));
  const costs = new Map(inventory.map((item) => [key(item.name), number(item.unit_cost ?? config.ingredient_cost)]));
  const rows = primary.map((item) => {
    const supplied = quantity(item.quantity);
    const onHand = current.get(key(item.name)) || 0;
    return {
      name: item.name,
      supplied,
      current: onHand,
      used: Math.max(0, supplied - onHand),
      unitCost: costs.get(key(item.name)) ?? number(config.ingredient_cost),
    };
  });
  const usedIngredients = rows.reduce((total, item) => total + item.used, 0);
  const perProduct = Math.max(1, quantity(config.ingredients_per_product));
  const productsSold = Math.floor(usedIngredients / perProduct);
  const gross = productsSold * number(config.sale_price);
  const vat = gross * number(config.vat_percent) / 100;
  const commission = gross * number(config.employee_commission_percent) / 100;
  const ingredientCost = rows.reduce((total, item) => total + item.used * item.unitCost, 0);
  return {
    products_sold: productsSold,
    used_ingredients: usedIngredients,
    unmatched_ingredients: usedIngredients % perProduct,
    gross_sales: gross,
    customer_payments: gross + vat,
    vat_liability: vat,
    employee_commissions: commission,
    bank_should_have: gross - commission,
    ingredient_cost: ingredientCost,
    estimated_profit: gross - commission - ingredientCost,
    source: "legacy_estimate",
  };
}

export function productAnalytics(recipes, inventory, config = {}) {
  const stock = new Map(inventory.map((item) => [key(item.name), quantity(item.quantity)]));
  const costs = new Map(inventory.map((item) => [key(item.name), number(item.unit_cost ?? config.ingredient_cost)]));
  const defaultCost = number(config.ingredient_cost);
  const salePrice = number(config.sale_price);
  const commission = salePrice * number(config.employee_commission_percent) / 100;
  return recipes.map((recipe) => {
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    const capacities = ingredients.map((item) => ({
      name: item.name,
      capacity: Math.floor((stock.get(key(item.name)) || 0) / Math.max(1, quantity(item.quantity))),
    }));
    const capacity = capacities.length ? Math.min(...capacities.map((item) => item.capacity)) : 0;
    const limiting = capacities.filter((item) => item.capacity === capacity).map((item) => item.name);
    const ingredientUnits = ingredients.reduce((total, item) => total + Math.max(1, quantity(item.quantity)), 0);
    const recipeCost = ingredients.reduce((total, item) => (
      total + Math.max(1, quantity(item.quantity)) * (costs.get(key(item.name)) ?? defaultCost)
    ), 0);
    const profit = salePrice - commission - recipeCost;
    const status = !ingredients.length ? "Recipe missing" : capacity === 0 ? "Blocked" : capacity < 10 ? "Low capacity" : "Ready";
    return {
      ...recipe,
      ingredientUnits,
      recipeCost,
      salePrice,
      commission,
      profit,
      margin: salePrice ? profit / salePrice * 100 : 0,
      capacity,
      limiting,
      status,
    };
  });
}

export function inventoryAnalytics(inventory, primary = [], recipes = [], config = {}) {
  const primaryMap = new Map(primary.map((item) => [key(item.name), quantity(item.quantity)]));
  const recipeLinks = new Map();
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients || []) {
      const ingredientKey = key(ingredient.name);
      if (!recipeLinks.has(ingredientKey)) recipeLinks.set(ingredientKey, []);
      recipeLinks.get(ingredientKey).push({ product: recipe.name, needed: Math.max(1, quantity(ingredient.quantity)) });
    }
  }
  return inventory.map((item) => {
    const current = quantity(item.quantity);
    const supplied = primaryMap.get(key(item.name)) || 0;
    const used = Math.max(0, supplied - current);
    const links = recipeLinks.get(key(item.name)) || [];
    const coverages = links.map((link) => Math.floor(current / link.needed));
    const minimumCapacity = coverages.length ? Math.min(...coverages) : null;
    let status = "Healthy";
    if (!links.length) status = "Not in recipe";
    else if (current === 0) status = "Out";
    else if (minimumCapacity < 10) status = "Critical";
    else if (minimumCapacity < 25) status = "Low";
    const unitCost = number(item.unit_cost ?? config.ingredient_cost);
    return {
      ...item,
      current,
      supplied,
      used,
      utilization: supplied ? used / supplied * 100 : 0,
      unitCost,
      value: current * unitCost,
      products: links.map((link) => link.product),
      status,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function groupExactSales(sales, keyForSale) {
  const groups = new Map();
  for (const sale of sales) {
    const groupKey = String(keyForSale(sale) || "Unknown");
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        saleCount: 0,
        units: 0,
        grossSales: 0,
        customerPayments: 0,
        vat: 0,
        commission: 0,
      });
    }
    const group = groups.get(groupKey);
    group.saleCount += 1;
    group.units += quantity(sale.quantity);
    group.grossSales += Number(sale.gross_sales || 0);
    group.customerPayments += Number(sale.customer_payment || 0);
    group.vat += Number(sale.vat_amount || 0);
    group.commission += Number(sale.employee_commission || 0);
  }
  return [...groups.values()].sort((a, b) => b.units - a.units || a.key.localeCompare(b.key));
}

function businessDay(value, timeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function buildAnalytics({ documents, sales = [], saleFinancials = [], role = "owner", timeZone = "UTC" }) {
  const inventory = documents.inventory?.content || [];
  const primary = documents.primary_inventory?.content || [];
  const recipes = documents.recipes?.content || [];
  const config = documents.config?.content || {};
  const targets = documents.stock_targets?.content || {};
  const fixedLegacy = documents.analytics_baseline?.content || null;
  const legacy = fixedLegacy && Object.keys(fixedLegacy).length
    ? fixedLegacy
    : role === "owner" && primary.length
      ? calculateLegacyEstimate(inventory, primary, config)
      : {};
  const financeBySale = new Map(saleFinancials.map((item) => [item.sale_id, item]));
  const exact = sales.reduce((result, sale) => {
    const financial = financeBySale.get(sale.id) || {};
    result.products_sold += quantity(sale.quantity);
    result.gross_sales += Number(sale.gross_sales || 0);
    result.customer_payments += Number(sale.customer_payment || 0);
    result.vat_liability += Number(sale.vat_amount || 0);
    result.employee_commissions += Number(sale.employee_commission || 0);
    result.bank_should_have += Number(financial.business_bank || 0);
    result.ingredient_cost += Number(financial.ingredient_cost || 0);
    result.estimated_profit += Number(financial.estimated_profit || 0);
    return result;
  }, {
    products_sold: 0,
    gross_sales: 0,
    customer_payments: 0,
    vat_liability: 0,
    employee_commissions: 0,
    bank_should_have: 0,
    ingredient_cost: 0,
    estimated_profit: 0,
    source: "exact_cloud_sales",
  });
  const exactBreakdowns = {
    byProduct: groupExactSales(sales, (sale) => sale.product_name),
    byEmployee: groupExactSales(sales, (sale) => sale.recorded_by),
    byDay: groupExactSales(sales, (sale) => businessDay(sale.occurred_at || sale.created_at, timeZone))
      .sort((a, b) => b.key.localeCompare(a.key)),
  };
  const products = productAnalytics(recipes, inventory, config);
  const items = inventoryAnalytics(inventory, primary, recipes, config);
  const excluded = new Set((config.excluded_items || []).map(key));
  const countedInventory = inventory.filter((item) => !excluded.has(key(item.name)));
  const currentUnits = countedInventory.reduce((total, item) => total + quantity(item.quantity), 0);
  const inventoryValue = items.reduce((total, item) => total + item.value, 0);
  const perProduct = Math.max(1, quantity(config.ingredients_per_product || 4));
  const total = {
    products_sold: number(legacy.products_sold) + exact.products_sold,
    gross_sales: number(legacy.gross_sales) + exact.gross_sales,
    customer_payments: number(legacy.customer_payments) + exact.customer_payments,
    vat_liability: number(legacy.vat_liability) + exact.vat_liability,
    employee_commissions: number(legacy.employee_commissions) + exact.employee_commissions,
    bank_should_have: number(legacy.bank_should_have) + exact.bank_should_have,
    ingredient_cost: number(legacy.ingredient_cost) + exact.ingredient_cost,
    estimated_profit: number(legacy.estimated_profit) + exact.estimated_profit,
  };
  total.margin = total.gross_sales ? total.estimated_profit / total.gross_sales * 100 : 0;

  const quality = [];
  const expectedUnits = Math.max(1, quantity(config.ingredients_per_product || 4));
  const mismatched = products.filter((product) => product.ingredientUnits && product.ingredientUnits !== expectedUnits);
  if (mismatched.length) quality.push({ level: "Warning", area: "Sales rules", message: `${mismatched.length} recipe(s) use a different ingredient count than the global ${expectedUnits}-ingredient legacy rule.` });
  quality.push({ level: "Info", area: "History", message: "Legacy shortage-based totals remain labeled as estimates; named cloud sales are exact." });
  quality.push({ level: "Info", area: "Employees", message: "Employee analytics begins with invited cloud accounts; historical employee performance was not invented." });

  return {
    legacy,
    exact,
    exactBreakdowns,
    total,
    inventory: {
      items,
      itemCount: items.length,
      currentUnits,
      inventoryValue,
      productsPossible: Math.floor(currentUnits / perProduct),
      unusedUnits: currentUnits % perProduct,
      lowCount: items.filter((item) => ["Out", "Critical", "Low"].includes(item.status)).length,
    },
    products,
    targets,
    quality,
  };
}

export function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (absolute < 60) return formatter.format(seconds, "second");
  if (absolute < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (absolute < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (absolute < 604800) return formatter.format(Math.round(seconds / 86400), "day");
  return date.toLocaleString();
}
