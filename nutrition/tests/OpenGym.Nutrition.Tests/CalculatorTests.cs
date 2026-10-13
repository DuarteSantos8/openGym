using OpenGym.Nutrition.Services;
using Xunit;

namespace OpenGym.Nutrition.Tests;

public sealed class CalculatorTests
{
    [Fact]
    public void FractionalQuantityKeepsPrecision()
    {
        var value = NutritionCalculator.ForQuantity(new(123.456m, 12.345m, 6.789m, 45.678m), 33.333m);
        Assert.Equal(new Nutrients(41.15158848m, 4.11495885m, 2.26297737m, 15.22584774m), value);
    }

    [Fact]
    public void TotalsDoNotRoundEachEntry()
    {
        var entry = NutritionCalculator.ForQuantity(new(1, 2, 3, 4), 0.1m);
        Assert.Equal(new Nutrients(0.003m, 0.006m, 0.009m, 0.012m), NutritionCalculator.Total([entry, entry, entry]));
        Assert.Equal(new Nutrients(0, 0, 0, 0), NutritionCalculator.Total([]));
        Assert.Equal(new Nutrients(1000, 2000, 3000, 4000), NutritionCalculator.ForQuantity(new(1, 2, 3, 4), 100000));
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("100000.001")]
    [InlineData("0.0001")]
    public void InvalidQuantityIsRejected(string quantity) => Assert.Throws<ArgumentOutOfRangeException>(() =>
        NutritionCalculator.ForQuantity(new(1, 2, 3, 4), decimal.Parse(quantity, System.Globalization.CultureInfo.InvariantCulture)));
}
