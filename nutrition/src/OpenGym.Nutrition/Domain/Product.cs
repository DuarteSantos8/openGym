namespace OpenGym.Nutrition.Domain;

/// <summary>A user's reusable food definition; nutritional values are per 100 grams.</summary>
public sealed class Product
{
    public Guid Id { get; set; }
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Brand { get; set; }
    public string SearchText { get; set; } = "";
    public decimal Calories { get; set; }
    public decimal Protein { get; set; }
    public decimal Fat { get; set; }
    public decimal Carbohydrates { get; set; }
    public bool IsDeleted { get; set; }
}
