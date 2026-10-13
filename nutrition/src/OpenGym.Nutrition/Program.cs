using OpenGym.Nutrition.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using OpenGym.Nutrition.Api;
using OpenGym.Nutrition.Persistence;
using OpenGym.Nutrition.Services;

var builder = WebApplication.CreateBuilder(args);
var nodeApi = builder.Configuration["OpenGym:ApiBaseUrl"] ?? "http://127.0.0.1:3000";
if (!Uri.TryCreate(nodeApi, UriKind.Absolute, out var apiUri)
    || (apiUri.Scheme != "http" && apiUri.Scheme != "https")
    || !string.IsNullOrEmpty(apiUri.UserInfo) || !string.IsNullOrEmpty(apiUri.Query)
    || !string.IsNullOrEmpty(apiUri.Fragment) || apiUri.AbsolutePath != "/")
    throw new InvalidOperationException("OpenGym:ApiBaseUrl must be an HTTP(S) origin.");

builder.Services.AddHttpClient(OpenGymAuthenticationHandler.ClientName, client =>
{
    client.BaseAddress = apiUri;
    client.Timeout = TimeSpan.FromSeconds(5);
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
{
    // Credentials belong to this request only. Never retain another user's cookies or
    // follow an authentication redirect to a different host.
    UseCookies = false,
    AllowAutoRedirect = false
});
builder.Services.AddAuthentication(OpenGymAuthenticationHandler.SchemeName)
    .AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions,
        OpenGymAuthenticationHandler>(OpenGymAuthenticationHandler.SchemeName, _ => { });
builder.Services.AddAuthorization();
builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
var databasePath = Path.GetFullPath(builder.Configuration["Nutrition:DatabasePath"] ?? "data/nutrition.db");
Directory.CreateDirectory(Path.GetDirectoryName(databasePath)!);
builder.Services.AddDbContext<NutritionDbContext>(options => options.UseSqlite(
    new SqliteConnectionStringBuilder { DataSource = databasePath, DefaultTimeout = 5 }.ToString()));
builder.Services.AddScoped<NutritionService>();
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 64 * 1024);

var app = builder.Build();
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<NutritionDbContext>();
    // Single service instance: fail startup on migration failure rather than serve an empty database.
    await db.Database.MigrateAsync();
}
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    try { await next(context); }
    catch (NutritionException ex)
    {
        context.Response.StatusCode = ex.Status;
        await context.Response.WriteAsJsonAsync(new { error = ex.Code, code = ex.Code });
    }
    catch (BadHttpRequestException ex)
    {
        context.Response.StatusCode = ex.StatusCode;
        await context.Response.WriteAsJsonAsync(new { error = "invalid_input", code = "invalid_input" });
    }
    catch (Exception ex) when (ex is SqliteException or DbUpdateException)
    {
        app.Logger.LogError(ex, "Nutrition database operation failed");
        context.Response.StatusCode = 503;
        await context.Response.WriteAsJsonAsync(new { error = "nutrition unavailable" });
    }
});
app.UseAuthentication();
app.UseAuthorization();
app.MapGet("/health", () => Results.Ok(new { ok = true })).AllowAnonymous();
app.MapGet("/api/nutrition/hello", (System.Security.Claims.ClaimsPrincipal user) =>
    Results.Ok(new { message = $"Hi, {user.Identity!.Name}!" })).RequireAuthorization();
app.MapNutrition();
app.Run();

// WebApplicationFactory exercises the real middleware and endpoint in tests.
public partial class Program { }
