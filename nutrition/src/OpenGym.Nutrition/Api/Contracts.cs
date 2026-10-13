using OpenGym.Nutrition.Services;

namespace OpenGym.Nutrition.Api;

public sealed record ProductRequest(string? Name, string? Brand, decimal? Calories,
    decimal? Protein, decimal? Fat, decimal? Carbohydrates);
public sealed record CreateEntryRequest(Guid Id, Guid ProductId, decimal QuantityGrams, string? Date, string? Time);
// Null ProductId keeps the historical snapshot; an explicit id replaces it with today's product.
public sealed record UpdateEntryRequest(decimal QuantityGrams, string? Date, string? Time, Guid? ProductId);
public sealed record ProductResponse(Guid Id, string Name, string? Brand, decimal Calories,
    decimal Protein, decimal Fat, decimal Carbohydrates);
public sealed record EntryResponse(Guid Id, Guid ProductId, string Name, string? Brand,
    decimal QuantityGrams, string Date, string? Time, Nutrients Per100Grams, Nutrients Nutrition);
public sealed record DiaryResponse(string Date, IReadOnlyList<EntryResponse> Entries, Nutrients Totals);
public sealed record ProductPage(IReadOnlyList<ProductResponse> Products, bool HasMore);

public sealed class NutritionException(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}
