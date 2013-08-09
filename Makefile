REPO = git@github.com:brendandahl/pdf.js.utils.git
BUILD_DIR = build
BASE_VERSION = ec7ead2b5a0fa898151d7c67b4f0f281a62e4a70
BUILD_NUMBER = git log --format=oneline $(BASE_VERSION).. | wc -l | awk '{print $$1}'
GIT_STATUS = git status --porcelain

# make web
#
# This target produces the website for the project, by checking out
# the gh-pages branch underneath the build directory, and then move
# the various viewer files into place.
GH_PAGES = $(BUILD_DIR)/gh-pages
web: | pages-repo
	@test -z "`$(GIT_STATUS) 2>&1`" || { echo; echo "Your working tree is not clean" 1>&2; $(GIT_STATUS); exit 1; }
	@cp -R browser/* $(GH_PAGES)/browser
	@cd $(GH_PAGES); git add -A; git commit -m "Build `$(BUILD_NUMBER)`."
	@echo
	@echo "Website built in $(GH_PAGES)."
	@echo "Don't forget to cd into $(GH_PAGES)/ and git push."

# make pages-repo
#
# This target clones the gh-pages repo into the build directory. It
# deletes the current contents of the repo, since we overwrite
# everything with data from the master repo. The 'make web' target
# then uses 'git add -A' to track additions, modifications, moves,
# and deletions.
pages-repo: | $(BUILD_DIR)
	@if [ ! -d "$(GH_PAGES)" ]; then \
	git clone -b gh-pages $(REPO) $(GH_PAGES); \
	rm -rf $(GH_PAGES)/*; \
	fi;
	@mkdir -p $(GH_PAGES)/browser;

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

clean:
	rm -rf $(BUILD_DIR)
