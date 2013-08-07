#! /usr/bin/env python

"""\
%prog [options] <pdf>

      Helper script to compare the perfomance of code changes for a PDF.

      Can be run in two modes:
       -stash: Compare stats of current changes and stashes them to build
               a baseline.
       -commits: Compare stats of two commit ids. Specify id's with -c and -b
                 options.
"""

import sys
import os
import shutil
from subprocess import call
from optparse import OptionParser

class TestOptions(OptionParser):
    def __init__(self, **kwargs):
        OptionParser.__init__(self, **kwargs)
        self.add_option("-m", "--mode", dest="mode", type="string",
                help="stash|commits [%default]", default="stash")
        self.add_option("-b", "--baseline", dest="baseline", type="string",
                help="Baseline commit id for commit mode.", default=None)
        self.add_option("-c", "--current", dest="current", type="string",
                help="Current commit id for commit mode.", default=None)
        self.add_option("-l", "--last_page", dest="last_page", type="int",
                help="Last page to run. [%default]", default=1)
        self.add_option("-r", "--rounds", dest="rounds", type="int",
                help="Rounds to run. [%default]", default=20)
        self.add_option("-t", "--test_path", dest="test_path", type="string",
                help="Path to the test directory. [%default]", default=".")

        self.set_usage(__doc__)

    def verify_options(self, options, args):
        if len(args) < 1:
            self.print_help()
            exit(-1)

        if not os.path.isfile(args[0]):
            self.error("test file not found '" + args[0] + "'")

        args[0] = os.path.abspath(args[0])

        os.chdir(options.test_path)

        if not os.path.exists('test.py'):
            self.error("test.py not found in directory '" + os.getcwd() + "'")


        if options.mode == "stash":
            if options.baseline is not None or options.current is not None:
                self.error("Invalid options for stash mode.")
        elif options.mode == "commits":
            if options.baseline is None or options.current is None:
                self.error("Baseline and Current options required for commits mode.")
        else:
            self.error("Unrecognized mode.")

        return options

def create_dir(dir):
    try:
        os.makedirs(dir)
    except OSError, e:
        if e.errno != 17: # file exists
            print >>sys.stderr, 'Creating', dir, 'failed!'

def call_die(command):
    if call(command, shell=True) != 0:
        print >>sys.stderr, 'Running command failed!'
        sys.exit(code);

def main():
    option_parser = TestOptions()
    options, args = option_parser.parse_args()
    options = option_parser.verify_options(options, args)
    parts = args[0].split('/')
    pdf_name = parts[-1]
    current_path = os.getcwd() + '/';
    path = current_path + 'stats/results/' + pdf_name + '/'
    print 'Creating dir: ' + path
    create_dir(path)
    shutil.copy(args[0], path)
    manifest_path = path + 'manifest.json'
    f = open(manifest_path, 'w')
    f.write('[{ "id": "' + pdf_name + '", "file": "/test/stats/results/' + pdf_name + '/' + pdf_name + '", "md5": "09a41b9a759d60c698228224ab85b46d", "rounds": ' + str(options.rounds) + ', "lastPage": ' + str(options.last_page) + ',"type": "load"}]')
    f.close()

    # Kick off testing
    run_test_py = 'python test.py --browserManifestFile=resources/browser_manifests/browser_manifest.json --manifestFile=stats/results/' + pdf_name + '/manifest.json --statsFile=' + path
    if (options.mode == "commits"):
        call_die('git checkout ' + options.current)
    call_die(run_test_py + 'current.json')

    if (options.mode == "commits"):
        call_die('git checkout ' + options.baseline)
    elif (options.mode == "stash"):
        call_die('git stash save')

    call_die(run_test_py + 'baseline.json')

    if (options.mode == "stash"):
        call_die('git stash pop')

    call_die('python stats/statcmp.py ' + path + 'baseline.json ' + path + 'current.json')

    # Cleanup
    os.remove(path + pdf_name);

if __name__ == '__main__':
    main()