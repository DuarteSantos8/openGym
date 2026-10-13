using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using OpenGym.Nutrition.Api;
using OpenGym.Nutrition.Authentication;
using OpenGym.Nutrition.Services;
using Xunit;

namespace OpenGym.Nutrition.Tests;

public sealed class DiaryApiTests
{
    private static ProductRequest Food(string name = "Гречка", decimal calories = 123.456m) => new(name, "Acme", calories, 12.345m, 6.789m, 45.678m);
    private static async Task<ProductResponse> CreateProduct(HttpClient client, ProductRequest? body = null)
    {
        var response = await client.PostAsJsonAsync("/api/nutrition/products", body ?? Food());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ProductResponse>())!;
    }
    private static CreateEntryRequest Consumption(Guid product, string? time = "12:00", decimal quantity = 100) =>
        new(Guid.NewGuid(), product, quantity, "2026-10-13", time);
    private static async Task<EntryResponse> CreateEntry(HttpClient client, CreateEntryRequest body)
    {
        var response = await client.PostAsJsonAsync("/api/nutrition/entries", body);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<EntryResponse>())!;
    }
    private static async Task<DiaryResponse> Day(HttpClient client, string date = "2026-10-13") =>
        (await client.GetFromJsonAsync<DiaryResponse>("/api/nutrition/diary?date=" + date))!;

    [Fact]
    public async Task ProductsCrudSearchAndIsolation()
    {
        using var factory = new DiaryFactory();
        using var alice = factory.Client("alice");
        using var bob = factory.Client("bob");
        var product = await CreateProduct(alice);
        Assert.Equal(product, await alice.GetFromJsonAsync<ProductResponse>("/api/nutrition/products/" + product.Id));
        Assert.Single((await alice.GetFromJsonAsync<ProductPage>("/api/nutrition/products?search=" + Uri.EscapeDataString("грЕЧ")))!.Products);
        Assert.Single((await alice.GetFromJsonAsync<ProductPage>("/api/nutrition/products?search=acme"))!.Products);
        Assert.Empty((await bob.GetFromJsonAsync<ProductPage>("/api/nutrition/products?userId=alice"))!.Products);
        foreach (var method in new[] { HttpMethod.Get, HttpMethod.Put, HttpMethod.Delete })
        {
            using var request = new HttpRequestMessage(method, "/api/nutrition/products/" + product.Id) { Content = JsonContent.Create(Food("Stolen")) };
            Assert.Equal(HttpStatusCode.NotFound, (await bob.SendAsync(request)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.OK, (await alice.PutAsJsonAsync("/api/nutrition/products/" + product.Id, Food("Updated", 150))).StatusCode);
        Assert.Equal("Updated", (await alice.GetFromJsonAsync<ProductResponse>("/api/nutrition/products/" + product.Id))!.Name);
        Assert.Empty((await alice.GetFromJsonAsync<ProductPage>("/api/nutrition/products?search=" + Uri.EscapeDataString("греч")))!.Products);
        Assert.Equal(HttpStatusCode.OK, (await alice.DeleteAsync("/api/nutrition/products/" + product.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await alice.DeleteAsync("/api/nutrition/products/" + product.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync("/api/nutrition/products/" + product.Id)).StatusCode);
        Assert.Empty((await alice.GetFromJsonAsync<ProductPage>("/api/nutrition/products"))!.Products);
    }

    [Fact]
    public async Task ProductPaginationHasNoMissingOrDuplicateRows()
    {
        using var factory = new DiaryFactory();
        using var client = factory.Client("alice");
        for (var i = 0; i < 51; i++) await CreateProduct(client, Food($"Product {i:00}"));
        var first = (await client.GetFromJsonAsync<ProductPage>("/api/nutrition/products"))!;
        var last = (await client.GetFromJsonAsync<ProductPage>("/api/nutrition/products?offset=50"))!;
        Assert.Equal(50, first.Products.Count);
        Assert.True(first.HasMore);
        Assert.Single(last.Products);
        Assert.False(last.HasMore);
        Assert.Equal(51, first.Products.Concat(last.Products).Select(p => p.Id).Distinct().Count());
        Assert.Equal("Product 50", last.Products[0].Name);
    }

    [Fact]
    public async Task DiarySnapshotsCrudOrderingAndTotals()
    {
        using var factory = new DiaryFactory();
        using var client = factory.Client("alice");
        using var other = factory.Client("bob");
        var product = await CreateProduct(client);
        var late = await CreateEntry(client, Consumption(product.Id, "18:30", 33.333m));
        var untimed = await CreateEntry(client, Consumption(product.Id, null, 50));
        var early = await CreateEntry(client, Consumption(product.Id, "08:00", 100));
        Assert.Equal(new Nutrients(41.15158848m, 4.11495885m, 2.26297737m, 15.22584774m), late.Nutrition);
        var day = await Day(client);
        Assert.Equal(new[] { early.Id, late.Id, untimed.Id }, day.Entries.Select(e => e.Id));
        Assert.Equal(new Nutrients(226.33558848m, 22.63245885m, 12.44647737m, 83.74284774m), day.Totals);
        Assert.Equal(new Nutrients(0, 0, 0, 0), (await Day(client, "2026-10-14")).Totals);
        Assert.Empty((await Day(other)).Entries);
        foreach (var method in new[] { HttpMethod.Get, HttpMethod.Put, HttpMethod.Delete })
        {
            using var request = new HttpRequestMessage(method, "/api/nutrition/entries/" + late.Id)
                { Content = JsonContent.Create(new UpdateEntryRequest(200, "2026-10-13", null, null)) };
            Assert.Equal(HttpStatusCode.NotFound, (await other.SendAsync(request)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.NotFound, (await CreateForeignEntry(other, product.Id)).StatusCode);
        await client.PutAsJsonAsync("/api/nutrition/products/" + product.Id, Food("Changed", 999));
        Assert.Equal(late, await client.GetFromJsonAsync<EntryResponse>("/api/nutrition/entries/" + late.Id));
        var updated = await client.PutAsJsonAsync("/api/nutrition/entries/" + late.Id, new UpdateEntryRequest(200, "2026-10-14", "09:15", null));
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var retained = (await updated.Content.ReadFromJsonAsync<EntryResponse>())!;
        Assert.Equal("Гречка", retained.Name);
        Assert.Equal(246.912m, retained.Nutrition.Calories);
        Assert.Equal("09:15", retained.Time);
        Assert.Equal(2, (await Day(client)).Entries.Count);
        var replaced = await client.PutAsJsonAsync("/api/nutrition/entries/" + late.Id, new UpdateEntryRequest(200, "2026-10-14", null, product.Id));
        var replacement = (await replaced.Content.ReadFromJsonAsync<EntryResponse>())!;
        Assert.Equal("Changed", replacement.Name);
        Assert.Equal(1998m, replacement.Nutrition.Calories);
        await client.DeleteAsync("/api/nutrition/products/" + product.Id);
        Assert.Equal(123.456m, (await client.GetFromJsonAsync<EntryResponse>("/api/nutrition/entries/" + early.Id))!.Nutrition.Calories);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/nutrition/entries/" + early.Id,
            new UpdateEntryRequest(50, "2026-10-13", null, null))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/nutrition/entries", Consumption(product.Id))).StatusCode);
        await client.DeleteAsync("/api/nutrition/entries/" + untimed.Id);
        Assert.Single((await Day(client)).Entries);
        Assert.Equal(61.728m, (await Day(client)).Totals.Calories);
    }

    private static Task<HttpResponseMessage> CreateForeignEntry(HttpClient client, Guid product) =>
        client.PostAsJsonAsync("/api/nutrition/entries", Consumption(product));

    [Fact]
    public async Task CreationRetryConflictAndDeletion()
    {
        using var factory = new DiaryFactory();
        using var client = factory.Client("alice");
        var product = await CreateProduct(client);
        var body = Consumption(product.Id);
        var entry = await CreateEntry(client, body);
        await client.PutAsJsonAsync("/api/nutrition/products/" + product.Id, Food("Changed", 500));
        var retry = await client.PostAsJsonAsync("/api/nutrition/entries", body);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        Assert.Equal(entry, await retry.Content.ReadFromJsonAsync<EntryResponse>());
        Assert.Single((await Day(client)).Entries);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/nutrition/entries", body with { QuantityGrams = 101 })).StatusCode);
        await client.DeleteAsync("/api/nutrition/products/" + product.Id);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/nutrition/entries", body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.DeleteAsync("/api/nutrition/entries/" + entry.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.DeleteAsync("/api/nutrition/entries/" + entry.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Gone, (await client.PostAsJsonAsync("/api/nutrition/entries", body)).StatusCode);
        Assert.Empty((await Day(client)).Entries);
    }

    [Fact]
    public async Task ConcurrentCreationCreatesOnlyOneEntry()
    {
        using var factory = new DiaryFactory();
        using var client = factory.Client("alice");
        var product = await CreateProduct(client);
        var body = Consumption(product.Id);
        var responses = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => client.PostAsJsonAsync("/api/nutrition/entries", body)));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Created);
        Assert.Equal(5, responses.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Single((await Day(client)).Entries);
    }

    [Theory]
    [InlineData("missing-name", "{\"calories\":1,\"protein\":1,\"fat\":1,\"carbohydrates\":1}")]
    [InlineData("blank-name", "{\"name\":\"  \",\"calories\":1,\"protein\":1,\"fat\":1,\"carbohydrates\":1}")]
    [InlineData("missing-nutrients", "{\"name\":\"Rice\"}")]
    [InlineData("negative", "{\"name\":\"Rice\",\"calories\":-1,\"protein\":1,\"fat\":1,\"carbohydrates\":1}")]
    [InlineData("macro-limit", "{\"name\":\"Rice\",\"calories\":1,\"protein\":100.001,\"fat\":1,\"carbohydrates\":1}")]
    [InlineData("calorie-limit", "{\"name\":\"Rice\",\"calories\":1000.001,\"protein\":1,\"fat\":1,\"carbohydrates\":1}")]
    [InlineData("precision", "{\"name\":\"Rice\",\"calories\":1.0001,\"protein\":1,\"fat\":1,\"carbohydrates\":1}")]
    public async Task InvalidProductsAreRejected(string caseName, string json)
    {
        Assert.NotEmpty(caseName);
        using var factory = new DiaryFactory();
        using var client = factory.Client("alice");
        var response = await client.PostAsync("/api/nutrition/products", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<ProductPage>("/api/nutrition/products"))!.Products);
    }

    [Fact]
    public async Task EntryAndQueryValidationRejectsInvalidValuesWithoutWrites()
    {
        using var factory = new DiaryFactory();
        using var client = factory.Client("alice");
        var product = await CreateProduct(client, new("Water", null, 0, 0, 0, 0));
        var body = Consumption(product.Id);
        foreach (var invalid in new[] { body with { Id = Guid.Empty }, body with { ProductId = Guid.Empty },
            body with { QuantityGrams = 0 }, body with { QuantityGrams = -1 }, body with { QuantityGrams = 100000.001m },
            body with { QuantityGrams = 0.0001m }, body with { Date = "2026-02-30" }, body with { Date = "2026-1-1" },
            body with { Date = null }, body with { Time = "24:00" }, body with { Time = "12:00:00" } })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/nutrition/entries", invalid)).StatusCode);
        foreach (var query in new[] { "/diary", "/diary?date=2026-02-30", "/products?offset=-1", "/products?offset=abc" })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/nutrition" + query)).StatusCode);
        Assert.Empty((await Day(client)).Entries);
        var zero = await CreateEntry(client, body with { QuantityGrams = 0.001m, Date = "2024-02-29", Time = "00:00" });
        Assert.Equal(new Nutrients(0, 0, 0, 0), zero.Nutrition);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/nutrition/entries/" + zero.Id,
            new UpdateEntryRequest(0, "2024-02-29", null, null))).StatusCode);
        Assert.Equal(zero, await client.GetFromJsonAsync<EntryResponse>("/api/nutrition/entries/" + zero.Id));
    }

    [Fact]
    public async Task DatabaseSurvivesRestartAndMigrationsAreRepeatable()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nutrition-restart-" + Guid.NewGuid());
        var path = Path.Combine(directory, "test.db");
        ProductResponse product;
        EntryResponse entry;
        try
        {
            using (var first = new DiaryFactory(path))
            using (var client = first.Client("alice"))
            {
                product = await CreateProduct(client);
                entry = await CreateEntry(client, Consumption(product.Id, null, 33.333m));
            }
            using var second = new DiaryFactory(path);
            using var reopened = second.Client("alice");
            Assert.Equal(product, await reopened.GetFromJsonAsync<ProductResponse>("/api/nutrition/products/" + product.Id));
            Assert.Equal(entry, Assert.Single((await Day(reopened)).Entries));
            using var connection = new SqliteConnection("Data Source=" + path);
            await connection.OpenAsync();
            using var command = connection.CreateCommand();
            command.CommandText = "SELECT COUNT(*) FROM __EFMigrationsHistory";
            Assert.Equal(1L, await command.ExecuteScalarAsync());
        }
        finally { SqliteConnection.ClearAllPools(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task EveryNutritionOperationRequiresAuthentication()
    {
        using var factory = new DiaryFactory();
        using var client = factory.CreateClient();
        foreach (var (method, path) in new[] { (HttpMethod.Get, "products"), (HttpMethod.Post, "products"),
            (HttpMethod.Get, "diary?date=2026-10-13"), (HttpMethod.Post, "entries"),
            (HttpMethod.Get, "products/" + Guid.NewGuid()), (HttpMethod.Put, "products/" + Guid.NewGuid()),
            (HttpMethod.Delete, "products/" + Guid.NewGuid()), (HttpMethod.Get, "entries/" + Guid.NewGuid()),
            (HttpMethod.Put, "entries/" + Guid.NewGuid()), (HttpMethod.Delete, "entries/" + Guid.NewGuid()) })
        {
            using var request = new HttpRequestMessage(method, "/api/nutrition/" + path) { Content = JsonContent.Create(new { userId = "alice" }) };
            request.Headers.Add("X-User-Id", "alice");
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(request)).StatusCode);
        }
    }

    [Fact]
    public async Task ProductLimitsAndNormalizationAreExplicit()
    {
        using var factory = new DiaryFactory();
        using var client = factory.Client("alice");
        var body = new ProductRequest("  " + new string('x', 200) + "  ", new string('b', 100), 1000, 100, 100, 100);
        var valid = await CreateProduct(client, body);
        Assert.Equal(new string('x', 200), valid.Name);
        Assert.Equal(body.Brand, valid.Brand);
        Assert.Equal(1000m, valid.Calories);
        foreach (var invalid in new[] { body with { Name = new string('x', 201) }, body with { Brand = new string('b', 101) },
            body with { Fat = -0.001m }, body with { Carbohydrates = 100.001m }, body with { Fat = 0.0001m } })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/nutrition/products", invalid)).StatusCode);
        var normalized = await CreateProduct(client, new("  Water  ", "  ", 0, 0, 0, 0));
        Assert.Equal("Water", normalized.Name);
        Assert.Null(normalized.Brand);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/nutrition/products?search=" + new string('x', 201))).StatusCode);
    }

    [Fact]
    public async Task MalformedBodiesReturnJsonValidationErrors()
    {
        using var factory = new DiaryFactory();
        using var client = factory.Client("alice");
        foreach (var (path, json) in new[] { ("products", "null"), ("products", "[]"), ("products", "{broken"),
            ("products", "{\"name\":\"Rice\",\"calories\":\"wrong\"}"), ("entries", "{\"id\":\"invalid\"}") })
        {
            var response = await client.PostAsync("/api/nutrition/" + path, new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            var error = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
            Assert.Equal("invalid_input", error.GetProperty("code").GetString());
        }
    }

    [Fact]
    public async Task RetryIdentityIsPerUserAndKeepsEditedEntryState()
    {
        using var factory = new DiaryFactory();
        using var alice = factory.Client("alice");
        using var bob = factory.Client("bob");
        var firstProduct = await CreateProduct(alice);
        var secondProduct = await CreateProduct(bob, Food("Bob food", 500));
        var body = Consumption(firstProduct.Id);
        var first = await CreateEntry(alice, body);
        var second = await CreateEntry(bob, body with { ProductId = secondProduct.Id });
        Assert.Equal(first.Id, second.Id);
        Assert.Equal(500m, second.Nutrition.Calories);
        var updated = await alice.PutAsJsonAsync("/api/nutrition/entries/" + first.Id, new UpdateEntryRequest(250, "2026-10-14", null, null));
        var edited = await updated.Content.ReadFromJsonAsync<EntryResponse>();
        var retry = await alice.PostAsJsonAsync("/api/nutrition/entries", body);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        Assert.Equal(edited, await retry.Content.ReadFromJsonAsync<EntryResponse>());
        Assert.Single((await Day(alice, "2026-10-14")).Entries);
        Assert.Empty((await Day(alice)).Entries);
        Assert.Single((await Day(bob)).Entries);
    }

    private sealed class DiaryFactory : WebApplicationFactory<Program>
    {
        private readonly bool ownsDirectory;
        private readonly string database;
        public DiaryFactory(string? path = null)
        {
            ownsDirectory = path is null;
            database = path ?? Path.Combine(Path.GetTempPath(), "nutrition-diary-" + Guid.NewGuid(), "test.db");
        }
        public HttpClient Client(string user)
        {
            var client = CreateClient();
            client.DefaultRequestHeaders.Add("Authorization", "Bearer " + user);
            return client;
        }
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseSetting("Nutrition:DatabasePath", database);
            builder.ConfigureServices(services => services.AddHttpClient(OpenGymAuthenticationHandler.ClientName)
                .ConfigurePrimaryHttpMessageHandler(() => new AuthBackend()));
        }
        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            SqliteConnection.ClearAllPools();
            if (ownsDirectory && Directory.Exists(Path.GetDirectoryName(database))) Directory.Delete(Path.GetDirectoryName(database)!, true);
        }
    }
    private sealed class AuthBackend : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var user = request.Headers.Authorization?.Parameter;
            return Task.FromResult(new HttpResponseMessage(user is "alice" or "bob" ? HttpStatusCode.OK : HttpStatusCode.Unauthorized)
                { Content = JsonContent.Create(new { user = new { id = user, name = user } }) });
        }
    }
}
