using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace OpenGym.Nutrition.Authentication;

public sealed class OpenGymAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IHttpClientFactory clients) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "OpenGym";
    public const string ClientName = "OpenGymApi";
    private bool unavailable;

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.ContainsKey("Cookie") && !Request.Headers.ContainsKey("Authorization"))
            return AuthenticateResult.NoResult();

        var delegated = Request.Headers.Authorization.ToString().StartsWith("Bearer ogn.", StringComparison.Ordinal);
        using var request = new HttpRequestMessage(HttpMethod.Get, delegated ? "/api/mcp/nutrition/identity" : "/api/me");
        // These values are credentials, never identity claims. Node verifies the signature,
        // expiry, session version and current account status for every request.
        foreach (var name in new[] { "Cookie", "Authorization" })
            if (Request.Headers.TryGetValue(name, out var value))
                request.Headers.TryAddWithoutValidation(name, value.ToArray());

        try
        {
            using var response = await clients.CreateClient(ClientName).SendAsync(request, Context.RequestAborted);
            if (response.StatusCode == HttpStatusCode.Unauthorized)
                return AuthenticateResult.Fail("The openGym session is invalid.");
            if (!response.IsSuccessStatusCode)
                return Unavailable();

            var me = await response.Content.ReadFromJsonAsync<MeResponse>(Context.RequestAborted);
            if (string.IsNullOrWhiteSpace(me?.User?.Id) || string.IsNullOrWhiteSpace(me.User.Name))
                return Unavailable();

            // Internal credentials authorize exactly one method/path and cannot become a
            // general browser session or be reused to alter the product catalog.
            if (delegated && (me.Delegated is null || me.Delegated.Method != Request.Method
                || me.Delegated.Pathname != Request.Path.Value))
                return AuthenticateResult.Fail("The Nutrition delegation does not authorize this operation.");

            var identity = new ClaimsIdentity([
                new Claim(ClaimTypes.NameIdentifier, me.User.Id),
                new Claim(ClaimTypes.Name, me.User.Name)
            ], SchemeName);
            return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or NotSupportedException)
        {
            if (Context.RequestAborted.IsCancellationRequested) throw;
            return Unavailable();
        }
    }

    private AuthenticateResult Unavailable()
    {
        unavailable = true;
        return AuthenticateResult.Fail("The openGym authentication service is unavailable.");
    }

    protected override async Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = unavailable ? StatusCodes.Status503ServiceUnavailable : StatusCodes.Status401Unauthorized;
        await Response.WriteAsJsonAsync(new { error = unavailable ? "authentication unavailable" : "not signed in" });
    }

    private sealed record MeResponse(UserResponse? User, DelegationResponse? Delegated);
    private sealed record DelegationResponse(string? Method, string? Pathname);
    private sealed record UserResponse(string? Id, string? Name);
}
