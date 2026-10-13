using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using OpenGym.Nutrition.Authentication;
using Xunit;

namespace OpenGym.Nutrition.Tests;

public sealed class AuthenticationTests
{
    [Fact]
    public async Task HealthIsPublicButClientIdentityHeadersDoNotAuthenticate()
    {
        using var factory = new NutritionFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
        client.DefaultRequestHeaders.Add("X-User-Name", "Mallory");
        client.DefaultRequestHeaders.Add("X-User-Id", "admin");
        var response = await client.GetAsync("/api/nutrition/hello?name=Mallory");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal(0, factory.Backend.Calls);
    }

    [Theory]
    [InlineData("Cookie", "__Host-gymsid=existing-session")]
    [InlineData("Authorization", "Bearer existing-session")]
    public async Task UsesOnlyIdentityReturnedByNode(string header, string credential)
    {
        using var factory = new NutritionFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add(header, credential);
        client.DefaultRequestHeaders.Add("X-User-Name", "Mallory");
        var response = await client.GetAsync("/api/nutrition/hello?name=Mallory");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Hi, Илья!", (await response.Content.ReadFromJsonAsync<Greeting>())?.Message);
        Assert.Equal("http://127.0.0.1:3000/api/me", factory.Backend.Target);
        Assert.Equal(credential, factory.Backend.Credential);
        Assert.False(factory.Backend.SpoofedIdentity);
    }

    [Fact]
    public async Task RechecksAccountAndSessionOnEveryRequest()
    {
        using var factory = new NutritionFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Cookie", "gymsid=existing-session");
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/nutrition/hello")).StatusCode);
        factory.Backend.Status = HttpStatusCode.Unauthorized;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/nutrition/hello")).StatusCode);
        Assert.Equal(2, factory.Backend.Calls);
    }

    [Theory]
    [InlineData(500, "{}")]
    [InlineData(302, "{}")]
    [InlineData(200, "<html>Login</html>")]
    [InlineData(200, "{}")]
    [InlineData(200, "{\"user\":{\"id\":\"u1\"}}")]
    public async Task UnavailableOrMalformedAuthFailsClosed(int status, string body)
    {
        using var factory = new NutritionFactory();
        factory.Backend.Status = (HttpStatusCode)status;
        factory.Backend.Body = body;
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Authorization", "Bearer existing-session");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/api/nutrition/hello")).StatusCode);
    }

    [Fact]
    public async Task AuthNetworkFailureReturnsServiceUnavailable()
    {
        using var factory = new NutritionFactory();
        factory.Backend.Unreachable = true;
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Cookie", "gymsid=existing-session");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/api/nutrition/hello")).StatusCode);
    }

    private sealed record Greeting(string Message);

    private sealed class NutritionFactory : WebApplicationFactory<Program>
    {
        private readonly string directory = Path.Combine(Path.GetTempPath(), "nutrition-auth-" + Guid.NewGuid());
        public AuthBackend Backend { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseSetting("Nutrition:DatabasePath", Path.Combine(directory, "test.db"));
            builder.ConfigureServices(services =>
            services.AddHttpClient(OpenGymAuthenticationHandler.ClientName)
                .ConfigurePrimaryHttpMessageHandler(() => Backend));
        }
        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }

    private sealed class AuthBackend : HttpMessageHandler
    {
        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
        public string Body { get; set; } = "{\"user\":{\"id\":\"u1\",\"name\":\"Илья\"}}";
        public bool Unreachable { get; set; }
        public int Calls { get; private set; }
        public string? Target { get; private set; }
        public string? Credential { get; private set; }
        public bool SpoofedIdentity { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            Target = request.RequestUri?.ToString();
            Credential = request.Headers.TryGetValues("Cookie", out var cookie)
                ? string.Join(";", cookie) : request.Headers.Authorization?.ToString();
            SpoofedIdentity = request.Headers.Contains("X-User-Name") || request.Headers.Contains("X-User-Id");
            if (Unreachable) throw new HttpRequestException("Backend offline");
            return Task.FromResult(new HttpResponseMessage(Status) { Content = new StringContent(Body, System.Text.Encoding.UTF8, "application/json") });
        }
    }
}
