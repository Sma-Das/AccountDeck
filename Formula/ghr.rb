class Ghr < Formula
  include Language::Python::Virtualenv

  desc "Repository-scoped GitHub authentication for concurrent agents"
  homepage "https://github.com/Sma-Das/AccountDeck"
  head "https://github.com/Sma-Das/AccountDeck.git", branch: "main"
  license "MIT"

  depends_on "gh"
  depends_on "python@3.13"

  def install
    cd "packages/github-router" do
      virtualenv_install_with_resources
    end
  end

  test do
    assert_match "0.3.0", shell_output("#{bin}/ghr --version")
    assert_match "[]", shell_output("GHR_CONFIG=#{testpath}/config.json #{bin}/ghr list")
  end
end
