# 📊 Auto Performance Report - Organized Framework

## 🏗️ Project Structure

```
Auto Perf Report/
├── index.js                    # Main entry point with command routing
├── package.json                # Dependencies and npm scripts  
├── .env                        # Environment configuration
├── src/                        # Organized source code
│   ├── core/                   # Core application logic
│   │   └── auto-report.js      # Main orchestrator script
│   ├── fetchers/               # Data fetching modules
│   │   ├── fetchdatadogmetrics.js       # Main metrics fetcher
│   │   ├── fetch-container-metrics.js   # Kubernetes metrics
│   │   └── fetch-error-metrics.js       # Error analysis
│   ├── generators/             # Report generators  
│   │   ├── confluence-uploader.js       # Confluence integration
│   │   └── generate-full-interactive-report.js  # HTML reports
│   ├── scripts/                # Specialized scripts
│   │   └── confluenceReportGenerator.js # Report formatting
│   └── utils/                  # Utility functions
│       ├── slack-poster.js     # Slack integration
│       └── deploy-to-main.js   # Deployment utilities
├── reports/                    # Generated report data
├── html-reports/               # Generated HTML files  
└── README.md                   # Project documentation
```

## 🚀 Usage

### Using the Main Entry Point
```bash
# View all available commands
node index.js help

# Fetch metrics
node index.js fetch --service "my-service" --from "Feb 9, 11:18 am" --to "Feb 9, 12:19 pm"

# Generate reports
node index.js confluence
node index.js generate-html

# Run full automation
node index.js auto-report --service "my-service" --from "Jan 9, 1:53 pm" --to "Jan 9, 2:24 pm"
```

### Using NPM Scripts
```bash
# Data fetching
npm run start                   # Main metrics fetcher
npm run fetch-container         # Container metrics
npm run fetch-errors           # Error metrics

# Report generation  
npm run generate-html           # Interactive HTML reports
npm run confluence             # Confluence reports

# Automation
npm run auto-report            # Full automated process

# Utilities
npm run slack                  # Post to Slack
npm run deploy                 # Deploy to main
```

### Direct Script Access
```bash
# Still works for backward compatibility
node src/fetchers/fetchdatadogmetrics.js --service "my-service"
node src/generators/confluence-uploader.js
```

## 🎯 Benefits of New Structure

1. **🗂️ Organization**: Clear separation of concerns with logical folder structure
2. **🔄 Maintainability**: Easy to find and modify specific functionality  
3. **📈 Scalability**: Simple to add new fetchers, generators, or utilities
4. **🔗 Flexibility**: Multiple ways to access functionality (entry point, npm scripts, direct)
5. **🔙 Compatibility**: Maintains backward compatibility with existing workflows

## 🛠️ Development

- **Add new fetcher**: Place in `src/fetchers/` and add to `index.js` commands
- **Add new generator**: Place in `src/generators/` and update npm scripts  
- **Add utilities**: Place in `src/utils/` for shared functionality
- **Update paths**: All internal references use relative paths from their locations