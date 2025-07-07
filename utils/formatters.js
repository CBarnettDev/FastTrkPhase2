export const formatDateNatural = (rawDate) => {
  const date = new Date(rawDate);
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "long" });

  // Convert day to ordinal (1st, 2nd, 3rd, etc)
  const suffixes = ["th", "st", "nd", "rd"];
  const suffix = suffixes[(day - 20) % 10] || suffixes[day] || suffixes[0];

  return `${month} ${day}${suffix}`;
};

export const formatPriceNatural = (priceStr) => {
  // Handle different price formats: "86k", "$86,000", "86000"
  const cleanPrice = priceStr.replace(/[^\dkK.]/gi, "").toLowerCase();

  if (cleanPrice.includes("k")) {
    const numValue = parseFloat(cleanPrice.replace("k", "")) * 1000;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(numValue);
  }

  const numValue = parseFloat(cleanPrice);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(numValue);
};

export const parseVehicleInfo = (vehicleStr) => {
  const [namePart, pricePart] = vehicleStr.split("-").map((s) => s.trim());
  return {
    vehicleName: namePart,
    vehiclePrice: pricePart ? formatPriceNatural(pricePart) : null,
  };
};