namespace OpenGym.Nutrition.Domain;

/// <summary>A consumption record with an independent snapshot, not a live product join.</summary>
public sealed class DiaryEntry
{
    public Guid Id { get; set; }
    public string UserId { get; set; } = "";
    public Guid ProductId { get; set; }
    public DateOnly Date { get; set; }
    public TimeOnly? Time { get; set; }
    public decimal QuantityGrams { get; set; }
    public string Name { get; set; } = "";
    public string? Brand { get; set; }
    public decimal Calories { get; set; }
    public decimal Protein { get; set; }
    public decimal Fat { get; set; }
    public decimal Carbohydrates { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    // Retain the original request and deletion marker so a late retry cannot recreate food.
    public string CreationFingerprint { get; set; } = "";
    public bool IsDeleted { get; set; }
}
