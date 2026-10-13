namespace OpenGym.Nutrition.Services;

public sealed record Nutrients(decimal Calories, decimal Protein, decimal Fat, decimal Carbohydrates);

/// <summary>Calculates from unrounded decimal snapshots; presentation rounding belongs to clients.</summary>
public static class NutritionCalculator
{
    public static Nutrients ForQuantity(Nutrients per100Grams, decimal quantityGrams)
    {
        if (quantityGrams <= 0 || quantityGrams > 100000 || decimal.Round(quantityGrams, 3) != quantityGrams)
            throw new ArgumentOutOfRangeException(nameof(quantityGrams));
        var factor = quantityGrams / 100m;
        return new(per100Grams.Calories * factor, per100Grams.Protein * factor,
            per100Grams.Fat * factor, per100Grams.Carbohydrates * factor);
    }

    public static Nutrients Total(IEnumerable<Nutrients> values) => values.Aggregate(
        new Nutrients(0, 0, 0, 0), (sum, value) => new(sum.Calories + value.Calories,
            sum.Protein + value.Protein, sum.Fat + value.Fat, sum.Carbohydrates + value.Carbohydrates));
}
