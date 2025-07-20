# Set the output zip file and target directory
$zipPath = "$PWD\be.zip"
$targetDir = "c:\Users\TalTe\Downloads\"

# List of files/folders to include
$itemsToZip = @(
    ".\config",
    ".\controllers",
    ".\middleware",
    ".\models",
    ".\routes",
    ".\scripts",
    ".\services",	
	".\utils",	
    ".\package.json",
    ".\server.js"
)

# Create the zip
if (Test-Path $zipPath) { Remove-Item $zipPath }
Compress-Archive -Path $itemsToZip -DestinationPath $zipPath

# Copy it to target directory
Copy-Item -Path $zipPath -Destination $targetDir -Force

Write-Host "✅ Successfully copied to $targetDir"
