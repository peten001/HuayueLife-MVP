using YunQiao.Cashier.Core.Protocol;

namespace YunQiao.Cashier.Core.Tests;

public sealed class CanonicalJsonHashTests
{
    [Fact]
    public void SortsObjectKeysRecursivelyAndRetainsArrayOrder()
    {
        const string input = "{\"z\":2,\"a\":{\"越\":3,\"b\":1},\"items\":[2,1]}";
        Assert.Equal("{\"a\":{\"b\":1,\"越\":3},\"items\":[2,1],\"z\":2}", CanonicalJsonHash.Canonicalize(input));
        Assert.True(CanonicalJsonHash.Matches(input, CanonicalJsonHash.Compute(input)));
    }

    [Theory]
    [InlineData("{\"value\":1.5}")]
    [InlineData("{\"value\":9007199254740992}")]
    public void RejectsNumbersOutsideAndroidReceiptRules(string input) =>
        Assert.Throws<InvalidDataException>(() => CanonicalJsonHash.Compute(input));
}
