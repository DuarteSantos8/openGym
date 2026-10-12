using OpenGym.Nutrition.Authentication;

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

var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    await next(context);
});
app.UseAuthentication();
app.UseAuthorization();
app.MapGet("/health", () => Results.Ok(new { ok = true })).AllowAnonymous();
app.MapGet("/api/nutrition/hello", (System.Security.Claims.ClaimsPrincipal user) =>
    Results.Ok(new { message = $"Hi, {user.Identity!.Name}!" })).RequireAuthorization();
app.Run();

// WebApplicationFactory exercises the real middleware and endpoint in tests.
public partial class Program { }
