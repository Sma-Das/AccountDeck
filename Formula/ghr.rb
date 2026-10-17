class Ghr < Formula
  include Language::Python::Virtualenv

  desc "Repository-scoped GitHub authentication for concurrent agents"
  homepage "https://github.com/Sma-Das/AccountDeck"
  head "https://github.com/Sma-Das/AccountDeck.git", branch: "main"
  license "MIT"

  depends_on "gh"
  depends_on "python@3.13"

  def install
    # The package lives in a subdirectory; virtualenv_install_with_resources
    # always installs buildpath, so point pip at the package directly.
    venv = virtualenv_create(libexec, "python3.13")
    venv.pip_install_and_link buildpath/"packages/github-router"
  end

  test do
    assert_match "0.3.0", shell_output("#{bin}/ghr --version")
    assert_match "[]", shell_output("GHR_CONFIG=#{testpath}/config.json #{bin}/ghr list")
  end
end
